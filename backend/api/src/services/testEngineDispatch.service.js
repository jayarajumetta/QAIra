const db = require("../db");
const { v4: uuid } = require("uuid");
const executionResultService = require("./executionResult.service");
const workspaceTransactionService = require("./workspaceTransaction.service");
const apiRequestExecutionService = require("./apiRequestExecution.service");
const executionStepRuntimeService = require("./executionStepRuntime.service");
const {
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType
} = require("../utils/testStepAutomation");

const SUPPORTED_ENGINE_STEP_TYPES = new Set(["api"]);
const DEFAULT_LEASE_SECONDS = Math.max(30, Number(process.env.TESTENGINE_JOB_LEASE_SECONDS || 90));

const selectProject = db.prepare(`
  SELECT id, name, display_id
  FROM projects
  WHERE id = ?
`);

const selectAppType = db.prepare(`
  SELECT id, name, type
  FROM app_types
  WHERE id = ?
`);

const selectTestCaseDispatchMetadata = db.prepare(`
  SELECT id, title, display_id, automated
  FROM test_cases
  WHERE id = ?
`);

const selectExecutionCaseIds = db.prepare(`
  SELECT test_case_id
  FROM execution_case_snapshots
  WHERE execution_id = ?
`);

const selectLatestResultsForExecution = db.prepare(`
  SELECT DISTINCT ON (test_case_id) test_case_id, status
  FROM execution_results
  WHERE execution_id = ?
  ORDER BY test_case_id ASC, created_at DESC, id DESC
`);

const settleExecutionStatus = db.prepare(`
  UPDATE executions
  SET status = ?, ended_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'running'
`);

const insertJob = db.prepare(`
  INSERT INTO test_engine_jobs (
    id,
    engine_run_id,
    integration_id,
    project_id,
    app_type_id,
    app_type_kind,
    execution_id,
    test_case_id,
    test_case_title,
    transaction_id,
    engine_host,
    payload,
    runtime_state,
    status,
    attempts,
    leased_by,
    lease_expires_at,
    started_at,
    completed_at,
    last_error,
    created_by
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectJob = db.prepare(`
  SELECT *
  FROM test_engine_jobs
  WHERE id = ?
`);

const updateJobLeaseState = db.prepare(`
  UPDATE test_engine_jobs
  SET status = ?,
      leased_by = ?,
      lease_expires_at = ?,
      started_at = COALESCE(started_at, ?),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateJobRuntimeState = db.prepare(`
  UPDATE test_engine_jobs
  SET status = ?,
      runtime_state = ?,
      lease_expires_at = ?,
      last_error = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const finalizeJobState = db.prepare(`
  UPDATE test_engine_jobs
  SET status = ?,
      runtime_state = ?,
      lease_expires_at = NULL,
      completed_at = ?,
      last_error = ?,
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

const nowIso = () => new Date().toISOString();

const normalizeJsonValue = (value, fallback) => {
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

const normalizeStringRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [key, entry]) => {
    const normalizedKey = normalizeText(String(key || "").replace(/^@+/, ""))?.toLowerCase();

    if (!normalizedKey) {
      return accumulator;
    }

    accumulator[normalizedKey] = entry === undefined || entry === null ? "" : String(entry);
    return accumulator;
  }, {});
};

const normalizeCapturedValuesRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [key, entry]) => {
    const normalizedKey = normalizeText(String(key || "").replace(/^@+/, ""))?.toLowerCase();

    if (!normalizedKey) {
      return accumulator;
    }

    accumulator[normalizedKey] = entry === undefined || entry === null ? "" : String(entry);
    return accumulator;
  }, {});
};

const toEngineKeyValueEntries = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => ({
      key: normalizeText(entry?.key),
      value: entry?.value === undefined || entry?.value === null ? "" : String(entry.value),
      is_secret: Boolean(entry?.is_secret)
    }))
    .filter((entry) => entry.key);
};

const toEngineDataSetRows = (rows) => {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) =>
      Object.entries(row).reduce((accumulator, [key, value]) => {
        const normalizedKey = normalizeText(String(key || ""));

        if (!normalizedKey) {
          return accumulator;
        }

        accumulator[normalizedKey] = value === undefined || value === null ? "" : String(value);
        return accumulator;
      }, {})
    );
};

const resolveEngineStepType = (stepType, appTypeKind) => {
  const normalized = normalizeTestStepType(stepType, null);

  if (normalized && SUPPORTED_ENGINE_STEP_TYPES.has(normalized)) {
    return normalized;
  }

  if (appTypeKind === "api" && !normalized) {
    return "api";
  }

  return null;
};

const buildManualSpec = ({ caseSnapshot, steps, execution }) => {
  const preconditions = [];
  const environmentName = execution.test_environment?.name;
  const environmentBaseUrl = execution.test_environment?.snapshot?.base_url;
  const suiteName = normalizeText(caseSnapshot.suite_name);

  if (suiteName && suiteName !== "Default") {
    preconditions.push(`Scope suite: ${suiteName}`);
  }

  if (environmentName) {
    preconditions.push(
      environmentBaseUrl
        ? `Environment: ${environmentName} (${environmentBaseUrl})`
        : `Environment: ${environmentName}`
    );
  }

  return {
    title: caseSnapshot.test_case_title,
    intent: normalizeText(caseSnapshot.test_case_description) || `Execute and validate ${caseSnapshot.test_case_title}`,
    preconditions,
    steps: steps.map((step) => step.action || `Step ${step.order}`),
    assertions: steps.map((step) => step.expected_result).filter(Boolean),
    test_data: {
      ...normalizeStringRecord(caseSnapshot.suite_parameter_values),
      ...normalizeStringRecord(caseSnapshot.parameter_values)
    },
    environment_notes: normalizeText(execution.test_environment?.snapshot?.notes)
  };
};

const buildEngineEnvelope = ({
  engineRunId,
  execution,
  project,
  appType,
  caseSnapshot,
  steps
}) => ({
  engine_run_id: engineRunId,
  qaira_run_id: execution.id,
  qaira_execution_id: execution.id,
  qaira_test_case_id: caseSnapshot.test_case_id,
  qaira_test_case_title: caseSnapshot.test_case_title,
  project: {
    id: project.id,
    name: project.name
  },
  app_type: {
    id: appType?.id || execution.app_type_id || "unknown",
    name: appType?.name || "Unknown App Type",
    kind: appType?.type || "web"
  },
  trigger: "execution",
  source_mode: "manual-handover",
  automated: true,
  browser: "chromium",
  headless: true,
  max_repair_attempts: 0,
  run_timeout_seconds: 1800,
  manual_spec: buildManualSpec({ caseSnapshot, steps, execution }),
  steps,
  suite_parameters: normalizeStringRecord(caseSnapshot.suite_parameter_values),
  case_parameters: normalizeStringRecord(caseSnapshot.parameter_values),
  environment: execution.test_environment
    ? {
        name: execution.test_environment.name,
        base_url: execution.test_environment.snapshot?.base_url || null,
        browser: execution.test_environment.snapshot?.browser || null,
        variables: toEngineKeyValueEntries(execution.test_environment.snapshot?.variables)
      }
    : null,
  configuration: execution.test_configuration
    ? {
        name: execution.test_configuration.name,
        browser: execution.test_configuration.snapshot?.browser || null,
        mobile_os: execution.test_configuration.snapshot?.mobile_os || null,
        platform_version: execution.test_configuration.snapshot?.platform_version || null,
        variables: toEngineKeyValueEntries(execution.test_configuration.snapshot?.variables)
      }
    : null,
  data_set: execution.test_data_set
    ? {
        name: execution.test_data_set.name,
        mode: execution.test_data_set.snapshot?.mode === "key_value" ? "key_value" : "table",
        columns: Array.isArray(execution.test_data_set.snapshot?.columns)
          ? execution.test_data_set.snapshot.columns.map((entry) => String(entry))
          : [],
        rows: toEngineDataSetRows(execution.test_data_set.snapshot?.rows)
      }
    : null,
  artifact_policy: {
    trace_mode: "off",
    video_mode: "off",
    screenshot_on_failure: false,
    capture_console: false,
    capture_network: false,
    artifact_retention_days: 7
  },
  callback: null
});

const summarizeWarnings = (warnings) => {
  if (!Array.isArray(warnings) || !warnings.length) {
    return [];
  }

  return warnings.map((warning) => String(warning)).filter(Boolean);
};

const parseStructuredLogs = (value) => {
  const parsed = normalizeJsonValue(value, {});

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      stepStatuses: {},
      stepNotes: {},
      stepEvidence: {},
      stepApiDetails: {}
    };
  }

  return {
    stepStatuses: parsed.stepStatuses && typeof parsed.stepStatuses === "object" && !Array.isArray(parsed.stepStatuses)
      ? { ...parsed.stepStatuses }
      : {},
    stepNotes: parsed.stepNotes && typeof parsed.stepNotes === "object" && !Array.isArray(parsed.stepNotes)
      ? { ...parsed.stepNotes }
      : {},
    stepEvidence: parsed.stepEvidence && typeof parsed.stepEvidence === "object" && !Array.isArray(parsed.stepEvidence)
      ? { ...parsed.stepEvidence }
      : {},
    stepApiDetails: parsed.stepApiDetails && typeof parsed.stepApiDetails === "object" && !Array.isArray(parsed.stepApiDetails)
      ? { ...parsed.stepApiDetails }
      : {}
  };
};

const parseRuntimeState = (value) => {
  const parsed = normalizeJsonValue(value, {});

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      captured_values: {},
      logs: parseStructuredLogs(null)
    };
  }

  return {
    captured_values: normalizeCapturedValuesRecord(parsed.captured_values),
    logs: parseStructuredLogs(parsed.logs)
  };
};

const hydrateJob = (row) => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    payload: normalizeJsonValue(row.payload, {}),
    runtime_state: parseRuntimeState(row.runtime_state)
  };
};

const buildRuntimeParameterValues = (envelope, capturedValues = {}) => {
  const values = {};

  Object.entries(envelope.suite_parameters || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeText(String(key || "").replace(/^@+/, ""))?.toLowerCase();
    if (!normalizedKey) {
      return;
    }
    values[`s.${normalizedKey.replace(/^s\./, "")}`] = String(value ?? "");
  });

  Object.entries(envelope.case_parameters || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeText(String(key || "").replace(/^@+/, ""))?.toLowerCase();
    if (!normalizedKey) {
      return;
    }
    values[`t.${normalizedKey.replace(/^t\./, "")}`] = String(value ?? "");
  });

  Object.entries(envelope.manual_spec?.test_data || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeText(String(key || "").replace(/^@+/, ""))?.toLowerCase();
    if (!normalizedKey) {
      return;
    }
    values[`t.${normalizedKey.replace(/^t\./, "")}`] = String(value ?? "");
  });

  (envelope.environment?.variables || []).forEach((entry) => {
    if (!entry?.key) {
      return;
    }
    values[`r.${normalizeText(entry.key).replace(/^r\./, "").toLowerCase()}`] = String(entry.value ?? "");
  });

  (envelope.configuration?.variables || []).forEach((entry) => {
    if (!entry?.key) {
      return;
    }
    values[`r.${normalizeText(entry.key).replace(/^r\./, "").toLowerCase()}`] = String(entry.value ?? "");
  });

  if (envelope.data_set?.mode === "key_value") {
    (envelope.data_set.rows || []).forEach((row) => {
      Object.entries(row).forEach(([key, value]) => {
        const normalizedKey = normalizeText(key)?.toLowerCase();

        if (!normalizedKey) {
          return;
        }

        values[`t.${normalizedKey}`] = String(value ?? "");
      });
    });
  } else if (Array.isArray(envelope.data_set?.rows) && envelope.data_set.rows.length) {
    Object.entries(envelope.data_set.rows[0] || {}).forEach(([key, value]) => {
      const normalizedKey = normalizeText(key)?.toLowerCase();

      if (!normalizedKey) {
        return;
      }

      values[`t.${normalizedKey}`] = String(value ?? "");
    });
  }

  return {
    ...values,
    ...normalizeCapturedValuesRecord(capturedValues)
  };
};

const resultStatusToJobStatus = (status) => {
  if (status === "passed") {
    return "completed";
  }

  if (status === "aborted") {
    return "aborted";
  }

  return "failed";
};

async function planExecutionDispatch(execution) {
  const [project, appType] = await Promise.all([
    selectProject.get(execution.project_id),
    execution.app_type_id ? selectAppType.get(execution.app_type_id) : Promise.resolve(null)
  ]);

  if (!project) {
    throw new Error("Execution project not found");
  }

  const stepsByCaseId = new Map();

  for (const stepSnapshot of execution.step_snapshots || []) {
    const current = stepsByCaseId.get(stepSnapshot.test_case_id) || [];
    current.push(stepSnapshot);
    stepsByCaseId.set(stepSnapshot.test_case_id, current);
  }

  const warnings = [];
  const eligibleCases = [];
  let automatedCaseCount = 0;
  let manualCaseCount = 0;
  let unsupportedAutomatedCaseCount = 0;

  for (const caseSnapshot of execution.case_snapshots || []) {
    const caseRecord = await selectTestCaseDispatchMetadata.get(caseSnapshot.test_case_id);

    if (caseRecord?.automated !== "yes") {
      manualCaseCount += 1;
      continue;
    }

    automatedCaseCount += 1;

    const rawSteps = stepsByCaseId.get(caseSnapshot.test_case_id) || [];

    if (!rawSteps.length) {
      unsupportedAutomatedCaseCount += 1;
      warnings.push(`${caseSnapshot.test_case_title}: automated case has no snapped steps to queue.`);
      continue;
    }

    const stepWarnings = [];
    const normalizedSteps = rawSteps.map((stepSnapshot) => {
      const stepType = resolveEngineStepType(stepSnapshot.step_type, appType?.type || null);

      if (!stepType) {
        stepWarnings.push(
          `${caseSnapshot.test_case_title}: step ${stepSnapshot.step_order} is not part of the API-first engine path yet.`
        );
        return null;
      }

      return {
        id: stepSnapshot.snapshot_step_id,
        order: stepSnapshot.step_order,
        step_type: stepType,
        action: normalizeText(stepSnapshot.action),
        expected_result: normalizeText(stepSnapshot.expected_result),
        automation_code: normalizeRichText(stepSnapshot.automation_code),
        api_request: stepType === "api" ? normalizeApiRequest(stepSnapshot.api_request) : null,
        group_name: normalizeText(stepSnapshot.group_name),
        group_kind: stepSnapshot.group_kind === "local" || stepSnapshot.group_kind === "reusable"
          ? stepSnapshot.group_kind
          : null
      };
    }).filter(Boolean);

    if (stepWarnings.length || normalizedSteps.length !== rawSteps.length) {
      unsupportedAutomatedCaseCount += 1;
      warnings.push(...stepWarnings);
      continue;
    }

    const engineRunId = uuid();
    eligibleCases.push({
      engine_run_id: engineRunId,
      case_snapshot: caseSnapshot,
      case_record: caseRecord,
      envelope: null,
      steps: normalizedSteps
    });
  }

  return {
    execution,
    project,
    appType,
    automated_case_count: automatedCaseCount,
    eligible_automated_case_count: eligibleCases.length,
    manual_case_count: manualCaseCount,
    unsupported_automated_case_count: unsupportedAutomatedCaseCount,
    warnings: summarizeWarnings(warnings),
    eligibleCases: eligibleCases.sort((left, right) =>
      Number(left.case_snapshot.sort_order || 0) - Number(right.case_snapshot.sort_order || 0)
    )
  };
}

async function settleExecutionIfComplete(executionId) {
  const requiredCaseIds = new Set(
    (await selectExecutionCaseIds.all(executionId))
      .map((row) => normalizeText(row.test_case_id))
      .filter(Boolean)
  );

  if (!requiredCaseIds.size) {
    return;
  }

  const latestResults = await selectLatestResultsForExecution.all(executionId);
  const latestStatusByCaseId = new Map(
    latestResults.map((result) => [normalizeText(result.test_case_id), normalizeText(result.status)])
  );

  if (
    [...requiredCaseIds].some((testCaseId) => !latestStatusByCaseId.has(testCaseId))
    || [...latestStatusByCaseId.values()].some((status) => status === "running")
  ) {
    return;
  }

  const nextExecutionStatus = [...latestStatusByCaseId.values()].every((status) => status === "passed")
    ? "completed"
    : "failed";

  await settleExecutionStatus.run(nextExecutionStatus, executionId);
}

async function queueExecutionDispatch({ plan, integration, initiatedBy }) {
  if (!plan.eligibleCases.length) {
    return {
      automated_case_count: plan.automated_case_count,
      queued_for_engine_count: 0,
      manual_case_count: plan.manual_case_count,
      unsupported_automated_case_count: plan.unsupported_automated_case_count,
      warnings: plan.warnings
    };
  }

  for (const item of plan.eligibleCases) {
    const envelope = buildEngineEnvelope({
      engineRunId: item.engine_run_id,
      execution: plan.execution,
      project: plan.project,
      appType: plan.appType,
      caseSnapshot: item.case_snapshot,
      steps: item.steps
    });

    const transaction = await workspaceTransactionService.createTransaction({
      project_id: plan.execution.project_id,
      app_type_id: plan.execution.app_type_id || null,
      category: "automation",
      action: "testengine_run",
      status: "queued",
      title: `Automated handoff for ${item.case_snapshot.test_case_title}`,
      description: "Queued for Test Engine execution.",
      metadata: {
        source: "qaira",
        engine_run_id: item.engine_run_id,
        execution_id: plan.execution.id,
        test_case_id: item.case_snapshot.test_case_id,
        engine_host: integration.base_url || null,
        queue_mode: "qaira-pull"
      },
      related_kind: "testengine_run",
      related_id: item.engine_run_id,
      created_by: initiatedBy || plan.execution.created_by || null,
      started_at: new Date().toISOString()
    });

    await workspaceTransactionService.appendTransactionEvent(transaction.id, {
      level: "info",
      phase: "dispatch.queued",
      message: `Queued ${item.case_snapshot.test_case_title} for Test Engine execution.`,
      details: {
        execution_id: plan.execution.id,
        test_case_id: item.case_snapshot.test_case_id,
        engine_run_id: item.engine_run_id
      }
    });

    await insertJob.run(
      uuid(),
      item.engine_run_id,
      integration.id || null,
      plan.execution.project_id,
      plan.execution.app_type_id || null,
      plan.appType?.type || "web",
      plan.execution.id,
      item.case_snapshot.test_case_id,
      item.case_snapshot.test_case_title,
      transaction.id,
      integration.base_url || null,
      envelope,
      {
        captured_values: {},
        logs: parseStructuredLogs(null)
      },
      "queued",
      0,
      null,
      null,
      null,
      null,
      null,
      initiatedBy || plan.execution.created_by || null
    );
  }

  return {
    automated_case_count: plan.automated_case_count,
    queued_for_engine_count: plan.eligibleCases.length,
    manual_case_count: plan.manual_case_count,
    unsupported_automated_case_count: plan.unsupported_automated_case_count,
    warnings: plan.warnings
  };
}

async function getQueuedJob(id) {
  const job = hydrateJob(await selectJob.get(id));

  if (!job) {
    throw new Error("Test Engine queue job not found");
  }

  return job;
}

exports.leaseNextQueuedJob = db.transaction(async ({ worker_id, engine_host, lease_seconds } = {}) => {
  const normalizedWorkerId = normalizeText(worker_id) || "testengine-worker";
  const normalizedEngineHost = normalizeText(engine_host);
  const safeLeaseSeconds = Math.max(30, Number(lease_seconds) || DEFAULT_LEASE_SECONDS);
  const params = [];
  let query = `
    SELECT *
    FROM test_engine_jobs
    WHERE app_type_kind = 'api'
      AND (
        status = 'queued'
        OR (
          status IN ('leased', 'running')
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < CURRENT_TIMESTAMP
          AND completed_at IS NULL
        )
      )
  `;

  if (normalizedEngineHost) {
    query += ` AND (engine_host IS NULL OR engine_host = ?)`;
    params.push(normalizedEngineHost);
  }

  query += ` ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;

  const result = await db.query(query, params);
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const leaseExpiresAt = new Date(Date.now() + safeLeaseSeconds * 1000).toISOString();

  await db.query(
    `
      UPDATE test_engine_jobs
      SET status = 'leased',
          leased_by = ?,
          lease_expires_at = ?,
          attempts = attempts + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [normalizedWorkerId, leaseExpiresAt, row.id]
  );

  const leased = await getQueuedJob(row.id);

  if (leased.transaction_id) {
    await workspaceTransactionService.appendTransactionEvent(leased.transaction_id, {
      level: "info",
      phase: "queue.leased",
      message: `${leased.test_case_title} was leased by the Test Engine worker.`,
      details: {
        job_id: leased.id,
        worker_id: normalizedWorkerId,
        lease_expires_at: leaseExpiresAt
      }
    });
  }

  return {
    ...leased,
    lease_expires_at: leaseExpiresAt
  };
});

exports.startQueuedJob = async ({ job_id, worker_id } = {}) => {
  const job = await getQueuedJob(job_id);
  const normalizedWorkerId = normalizeText(worker_id) || job.leased_by || "testengine-worker";
  const leaseExpiresAt = new Date(Date.now() + DEFAULT_LEASE_SECONDS * 1000).toISOString();
  const runtimeState = parseRuntimeState(job.runtime_state);
  const logs = parseStructuredLogs(runtimeState.logs);
  const startedAt = job.started_at || nowIso();

  await updateJobLeaseState.run("running", normalizedWorkerId, leaseExpiresAt, startedAt, job.id);

  const result = await executionResultService.upsertExecutionResult({
    execution_id: job.execution_id,
    test_case_id: job.test_case_id,
    app_type_id: job.app_type_id,
    status: "running",
    duration_ms: null,
    error: null,
    logs: JSON.stringify(logs),
    executed_by: job.created_by || null
  });

  if (job.transaction_id) {
    await workspaceTransactionService.appendTransactionEvent(job.transaction_id, {
      level: "info",
      phase: "run.started",
      message: `${job.test_case_title} started in the Test Engine.`,
      details: {
        job_id: job.id,
        execution_result_id: result.id,
        worker_id: normalizedWorkerId
      },
      status: "running",
      description: "Engine execution running.",
      metadata: {
        execution_result_id: result.id,
        current_phase: "running"
      }
    });
  }

  return {
    job_id: job.id,
    execution_result_id: result.id,
    status: "running"
  };
};

exports.executeQueuedApiStep = async ({ job_id, step_id } = {}) => {
  const job = await getQueuedJob(job_id);

  if (!job.payload?.steps?.length) {
    throw new Error("Queued job payload is missing step data");
  }

  const step = job.payload.steps.find((entry) => entry.id === step_id);

  if (!step) {
    throw new Error("Queued job step not found");
  }

  const runtimeState = parseRuntimeState(job.runtime_state);
  const existingLogs = parseStructuredLogs(runtimeState.logs);
  const parameterValues = buildRuntimeParameterValues(job.payload, runtimeState.captured_values);
  const stepResult = await apiRequestExecutionService.executeApiRequestStep({
    api_request: step.api_request,
    parameter_values: parameterValues
  });
  const formattedStepNote = executionStepRuntimeService.formatApiStepEvidenceNote(stepResult);
  const mergedLogs = {
    ...existingLogs,
    stepStatuses: {
      ...existingLogs.stepStatuses,
      [step.id]: stepResult.status
    },
    stepNotes: {
      ...existingLogs.stepNotes,
      [step.id]: formattedStepNote
    },
    stepEvidence: {
      ...existingLogs.stepEvidence
    },
    stepApiDetails: {
      ...existingLogs.stepApiDetails,
      [step.id]: stepResult.detail
    }
  };
  const nextRuntimeState = {
    captured_values: {
      ...runtimeState.captured_values,
      ...normalizeCapturedValuesRecord(stepResult.captures)
    },
    logs: mergedLogs
  };
  const startedAt = job.started_at ? new Date(job.started_at).getTime() : Date.now();
  const durationMs = Math.max(Date.now() - startedAt, stepResult.duration_ms || 0);
  const caseStatus = stepResult.status === "failed" ? "failed" : "running";

  await updateJobRuntimeState.run(
    "running",
    nextRuntimeState,
    new Date(Date.now() + DEFAULT_LEASE_SECONDS * 1000).toISOString(),
    stepResult.status === "failed" ? stepResult.note : null,
    job.id
  );

  const result = await executionResultService.upsertExecutionResult({
    execution_id: job.execution_id,
    test_case_id: job.test_case_id,
    app_type_id: job.app_type_id,
    status: caseStatus,
    duration_ms: durationMs,
    error: stepResult.status === "failed" ? stepResult.note : null,
    logs: JSON.stringify(mergedLogs),
    executed_by: job.created_by || null
  });

  if (job.transaction_id) {
    await workspaceTransactionService.appendTransactionEvent(job.transaction_id, {
      level: stepResult.status === "failed" ? "error" : "info",
      phase: stepResult.status === "failed" ? "step.failed" : "step.completed",
      message: stepResult.note,
      details: {
        job_id: job.id,
        step_id: step.id,
        step_order: step.order,
        execution_result_id: result.id,
        captures: stepResult.captures
      },
      status: "running",
      metadata: {
        execution_result_id: result.id,
        current_phase: stepResult.status === "failed" ? "step-failed" : "step-completed",
        last_step_id: step.id
      }
    });
  }

  return {
    job_id: job.id,
    step_id: step.id,
    status: stepResult.status,
    note: stepResult.note,
    detail: stepResult.detail,
    captures: stepResult.captures,
    case_status: caseStatus,
    execution_result_id: result.id
  };
};

exports.completeQueuedJob = async ({ job_id, status, error } = {}) => {
  const job = await getQueuedJob(job_id);
  const runtimeState = parseRuntimeState(job.runtime_state);
  const logs = parseStructuredLogs(runtimeState.logs);
  const stepIds = Array.isArray(job.payload?.steps) ? job.payload.steps.map((step) => step.id) : [];
  const resolvedStatuses = stepIds.map((stepId) => logs.stepStatuses[stepId]).filter(Boolean);
  let finalStatus = normalizeText(status);

  if (finalStatus !== "passed" && finalStatus !== "failed" && finalStatus !== "blocked") {
    if (resolvedStatuses.includes("failed")) {
      finalStatus = "failed";
    } else if (stepIds.length && resolvedStatuses.length === stepIds.length && resolvedStatuses.every((value) => value === "passed")) {
      finalStatus = "passed";
    } else {
      finalStatus = "blocked";
    }
  }

  const startedAt = job.started_at ? new Date(job.started_at).getTime() : Date.now();
  const durationMs = Math.max(Date.now() - startedAt, 0);
  const errorMessage = normalizeText(error) || (finalStatus === "failed" ? "API execution failed." : null);
  const completedAt = nowIso();

  await finalizeJobState.run(
    resultStatusToJobStatus(finalStatus),
    runtimeState,
    completedAt,
    errorMessage,
    job.id
  );

  const result = await executionResultService.upsertExecutionResult({
    execution_id: job.execution_id,
    test_case_id: job.test_case_id,
    app_type_id: job.app_type_id,
    status: finalStatus,
    duration_ms: durationMs,
    error: errorMessage,
    logs: JSON.stringify(logs),
    executed_by: job.created_by || null
  });

  if (job.transaction_id) {
    await workspaceTransactionService.appendTransactionEvent(job.transaction_id, {
      level: finalStatus === "passed" ? "success" : finalStatus === "failed" ? "error" : "warning",
      phase: finalStatus === "passed" ? "run.completed" : finalStatus === "failed" ? "run.failed" : "run.blocked",
      message:
        finalStatus === "passed"
          ? `${job.test_case_title} completed successfully.`
          : errorMessage || `${job.test_case_title} finished with ${finalStatus}.`,
      details: {
        job_id: job.id,
        execution_result_id: result.id,
        status: finalStatus
      },
      status: finalStatus === "passed" ? "completed" : "failed",
      description:
        finalStatus === "passed"
          ? "Engine execution completed."
          : errorMessage || "Engine execution failed.",
      metadata: {
        execution_result_id: result.id,
        current_phase: finalStatus === "passed" ? "completed" : "failed"
      }
    });

    await workspaceTransactionService.updateTransaction(job.transaction_id, {
      status: finalStatus === "passed" ? "completed" : "failed",
      completed_at: completedAt,
      description:
        finalStatus === "passed"
          ? "Engine execution completed."
          : errorMessage || "Engine execution failed."
    });
  }

  await settleExecutionIfComplete(job.execution_id);

  return {
    job_id: job.id,
    execution_result_id: result.id,
    status: finalStatus
  };
};

exports.failQueuedJob = async ({ job_id, message } = {}) => {
  return exports.completeQueuedJob({
    job_id,
    status: "failed",
    error: normalizeText(message) || "Test Engine execution failed."
  });
};

exports.getQueuedJob = getQueuedJob;
exports.planExecutionDispatch = planExecutionDispatch;
exports.queueExecutionDispatch = queueExecutionDispatch;
exports.settleExecutionIfComplete = settleExecutionIfComplete;
