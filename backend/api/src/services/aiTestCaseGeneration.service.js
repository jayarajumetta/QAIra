const db = require("../db");
const { v4: uuid } = require("uuid");
const requirementDesignService = require("./requirementDesign.service");
const testCaseService = require("./testCase.service");

const DEFAULT_CASES_PER_REQUIREMENT = 8;
const DEFAULT_PARALLEL_REQUIREMENTS = 2;
const MAX_CASES_PER_REQUIREMENT = 20;
const MAX_PARALLEL_REQUIREMENTS = 10;

const processingJobIds = new Set();
let isQueueProcessing = false;

const selectAppType = db.prepare(`
  SELECT id, name, type, project_id
  FROM app_types
  WHERE id = ?
`);

const selectRequirement = db.prepare(`
  SELECT id, title, description, priority, status, project_id
  FROM requirements
  WHERE id = ?
`);

const selectUser = db.prepare(`
  SELECT id
  FROM users
  WHERE id = ?
`);

const selectJob = db.prepare(`
  SELECT *
  FROM ai_test_case_generation_jobs
  WHERE id = ?
`);

const selectQueuedJobs = db.prepare(`
  SELECT id
  FROM ai_test_case_generation_jobs
  WHERE status = 'queued'
  ORDER BY created_at ASC, id ASC
`);

const insertJob = db.prepare(`
  INSERT INTO ai_test_case_generation_jobs (
    id,
    project_id,
    app_type_id,
    integration_id,
    requirement_ids,
    max_cases_per_requirement,
    parallel_requirement_limit,
    additional_context,
    external_links,
    images,
    status,
    total_requirements,
    processed_requirements,
    generated_cases_count,
    error,
    created_by
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, 0, NULL, ?)
`);

const markJobRunning = db.prepare(`
  UPDATE ai_test_case_generation_jobs
  SET status = 'running',
      error = NULL,
      started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
      completed_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateJobProgress = db.prepare(`
  UPDATE ai_test_case_generation_jobs
  SET processed_requirements = ?,
      generated_cases_count = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const finishJob = db.prepare(`
  UPDATE ai_test_case_generation_jobs
  SET status = ?,
      processed_requirements = ?,
      generated_cases_count = ?,
      error = ?,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeTextList = (values = []) =>
  [...new Set((Array.isArray(values) ? values : [values]).map((value) => normalizeText(value)).filter(Boolean))];

const normalizeImageAssets = (images = []) => {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .map((image, index) => ({
      name: normalizeText(image?.name) || `Reference image ${index + 1}`,
      url: normalizeText(image?.url)
    }))
    .filter((image) => image.url);
};

const parseJsonValue = (value, fallback) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
};

const clampInteger = (value, { fallback, min, max }) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.min(Math.round(numeric), max));
};

const buildJobErrorMessage = (errors = []) => {
  if (!errors.length) {
    return null;
  }

  return errors.slice(0, 3).join(" | ");
};

async function hydrateJob(job) {
  if (!job) {
    return job;
  }

  return {
    ...job,
    requirement_ids: parseJsonValue(job.requirement_ids, []),
    external_links: parseJsonValue(job.external_links, []),
    images: parseJsonValue(job.images, []),
    total_requirements: Number(job.total_requirements || 0),
    processed_requirements: Number(job.processed_requirements || 0),
    generated_cases_count: Number(job.generated_cases_count || 0),
    max_cases_per_requirement: Number(job.max_cases_per_requirement || DEFAULT_CASES_PER_REQUIREMENT),
    parallel_requirement_limit: Number(job.parallel_requirement_limit || DEFAULT_PARALLEL_REQUIREMENTS)
  };
}

async function resolveScopedRequirements(requirementIds = [], projectId) {
  const ids = normalizeTextList(requirementIds);

  if (!ids.length) {
    throw new Error("Select at least one requirement");
  }

  const requirements = [];

  for (const requirementId of ids) {
    const requirement = await selectRequirement.get(requirementId);

    if (!requirement) {
      throw new Error(`Requirement not found: ${requirementId}`);
    }

    if (requirement.project_id !== projectId) {
      throw new Error("Requirements must belong to the same project as the selected app type");
    }

    requirements.push(requirement);
  }

  return requirements;
}

async function generateCasesForRequirement({
  job,
  requirement,
  appType
}) {
  const preview = await requirementDesignService.previewRequirementTestCases({
    requirement,
    appType,
    integration_id: job.integration_id || undefined,
    max_cases: job.max_cases_per_requirement,
    additional_context: job.additional_context || undefined,
    external_links: job.external_links || [],
    images: job.images || []
  });

  let createdCount = 0;

  for (const candidate of preview.cases || []) {
    await testCaseService.createTestCase({
      app_type_id: appType.id,
      title: candidate.title,
      description: candidate.description || undefined,
      priority: candidate.priority,
      status: "draft",
      requirement_ids: candidate.requirement_ids?.length ? candidate.requirement_ids : [requirement.id],
      steps: candidate.steps || [],
      ai_generation_source: "scheduler",
      ai_generation_review_status: "pending",
      ai_generation_job_id: job.id,
      ai_generated_at: new Date().toISOString()
    });
    createdCount += 1;
  }

  return createdCount;
}

async function runJob(jobId) {
  if (!jobId || processingJobIds.has(jobId)) {
    return null;
  }

  processingJobIds.add(jobId);

  try {
    const queuedJob = await exports.getJob(jobId);

    if (!queuedJob || queuedJob.status !== "queued") {
      return queuedJob;
    }

    const appType = await selectAppType.get(queuedJob.app_type_id);

    if (!appType) {
      await finishJob.run("failed", 0, 0, "Selected app type no longer exists.", jobId);
      return exports.getJob(jobId);
    }

    const requirements = await resolveScopedRequirements(queuedJob.requirement_ids, appType.project_id);
    const workerCount = Math.min(
      requirements.length,
      clampInteger(queuedJob.parallel_requirement_limit, {
        fallback: DEFAULT_PARALLEL_REQUIREMENTS,
        min: 1,
        max: MAX_PARALLEL_REQUIREMENTS
      })
    );

    await markJobRunning.run(jobId);

    let processedRequirements = 0;
    let generatedCasesCount = 0;
    const errors = [];
    const queue = [...requirements];

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (queue.length) {
          const requirement = queue.shift();

          if (!requirement) {
            return;
          }

          try {
            generatedCasesCount += await generateCasesForRequirement({
              job: queuedJob,
              requirement,
              appType
            });
          } catch (error) {
            errors.push(
              `${requirement.title}: ${error instanceof Error ? error.message : "Unable to generate test cases"}`
            );
          } finally {
            processedRequirements += 1;
            await updateJobProgress.run(processedRequirements, generatedCasesCount, jobId);
          }
        }
      })
    );

    await finishJob.run(
      errors.length ? "failed" : "completed",
      processedRequirements,
      generatedCasesCount,
      buildJobErrorMessage(errors),
      jobId
    );

    return exports.getJob(jobId);
  } catch (error) {
    await finishJob.run("failed", 0, 0, error instanceof Error ? error.message : "Unable to process AI generation job", jobId);
    return exports.getJob(jobId);
  } finally {
    processingJobIds.delete(jobId);
  }
}

exports.createJob = async ({
  app_type_id,
  requirement_ids = [],
  integration_id,
  max_cases_per_requirement,
  parallel_requirement_limit,
  additional_context,
  external_links = [],
  images = [],
  created_by
}) => {
  const appType = await selectAppType.get(app_type_id);

  if (!appType) {
    throw new Error("App type not found");
  }

  if (!created_by) {
    throw new Error("created_by is required");
  }

  const user = await selectUser.get(created_by);

  if (!user) {
    throw new Error("Invalid user");
  }

  const requirements = await resolveScopedRequirements(requirement_ids, appType.project_id);
  const id = uuid();

  await insertJob.run(
    id,
    appType.project_id,
    appType.id,
    normalizeText(integration_id),
    requirements.map((requirement) => requirement.id),
    clampInteger(max_cases_per_requirement, {
      fallback: DEFAULT_CASES_PER_REQUIREMENT,
      min: 1,
      max: MAX_CASES_PER_REQUIREMENT
    }),
    clampInteger(parallel_requirement_limit, {
      fallback: DEFAULT_PARALLEL_REQUIREMENTS,
      min: 1,
      max: MAX_PARALLEL_REQUIREMENTS
    }),
    normalizeText(additional_context),
    normalizeTextList(external_links),
    normalizeImageAssets(images),
    requirements.length,
    created_by
  );

  return { id };
};

exports.listJobs = async ({ app_type_id, status } = {}) => {
  let query = `SELECT * FROM ai_test_case_generation_jobs WHERE 1=1`;
  const params = [];

  if (app_type_id) {
    query += ` AND app_type_id = ?`;
    params.push(app_type_id);
  }

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  query += ` ORDER BY created_at DESC, id DESC`;

  const rows = await db.prepare(query).all(...params);
  return Promise.all(rows.map(hydrateJob));
};

exports.getJob = async (id) => {
  const job = await selectJob.get(id);

  if (!job) {
    throw new Error("AI test case generation job not found");
  }

  return hydrateJob(job);
};

exports.processQueuedJobs = async () => {
  if (isQueueProcessing) {
    return;
  }

  isQueueProcessing = true;

  try {
    const queuedJobs = await selectQueuedJobs.all();

    for (const row of queuedJobs) {
      await runJob(row.id);
    }
  } finally {
    isQueueProcessing = false;
  }
};

exports.triggerJobProcessing = () => {
  setTimeout(() => {
    void exports.processQueuedJobs();
  }, 0);
};
