const db = require("../db");
const { v4: uuid } = require("uuid");
const requirementTestCaseService = require("./requirementTestCase.service");
const suiteTestCaseService = require("./suiteTestCase.service");
const sharedStepSyncService = require("./sharedStepSync.service");
const { DOMAIN_METADATA, TEST_CASE_STATUS_VALUES } = require("../domain/catalog");

const DEFAULT_PRIORITY = 3;
const DEFAULT_STATUS = DOMAIN_METADATA.test_cases.default_status;

const selectAppType = db.prepare(`
  SELECT id, project_id
  FROM app_types
  WHERE id = ?
`);

const selectSuite = db.prepare(`
  SELECT id, app_type_id
  FROM test_suites
  WHERE id = ?
`);

const selectRequirement = db.prepare(`
  SELECT id, project_id
  FROM requirements
  WHERE id = ?
`);

const selectSharedStepGroup = db.prepare(`
  SELECT id, app_type_id, name
  FROM shared_step_groups
  WHERE id = ?
`);

const insertTestCaseRecord = db.prepare(`
  INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, status, requirement_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateTestCaseRecord = db.prepare(`
  UPDATE test_cases
  SET app_type_id = ?, suite_id = ?, title = ?, description = ?, priority = ?, status = ?, requirement_id = ?
  WHERE id = ?
`);

const insertSuiteMapping = db.prepare(`
  INSERT INTO suite_test_cases (suite_id, test_case_id, sort_order)
  VALUES (?, ?, ?)
`);

const deleteSuiteMappings = db.prepare(`
  DELETE FROM suite_test_cases
  WHERE test_case_id = ?
`);

const insertRequirementMapping = db.prepare(`
  INSERT INTO requirement_test_cases (requirement_id, test_case_id)
  VALUES (?, ?)
  ON CONFLICT DO NOTHING
`);

const deleteRequirementMappings = db.prepare(`
  DELETE FROM requirement_test_cases
  WHERE test_case_id = ?
`);

const insertStep = db.prepare(`
  INSERT INTO test_steps (id, test_case_id, step_order, action, expected_result, group_id, group_name, group_kind, reusable_group_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const deleteStepsForTestCase = db.prepare(`
  DELETE FROM test_steps
  WHERE test_case_id = ?
`);

const deleteTestCaseRecord = db.prepare(`
  DELETE FROM test_cases
  WHERE id = ?
`);

const hydrateSuiteIds = async (testCase) => {
  if (!testCase) {
    return testCase;
  }

  return {
    ...testCase,
    suite_ids: await suiteTestCaseService.getSuiteIdsForTestCase(testCase.id),
    requirement_ids: await requirementTestCaseService.getRequirementIdsForTestCase(testCase.id)
  };
};

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeTextList = (values = []) => {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
};

const normalizePriority = (value) => {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_PRIORITY;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : DEFAULT_PRIORITY;
};

const normalizeStatus = (value, fallback = DEFAULT_STATUS) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return fallback;
  }

  if (!TEST_CASE_STATUS_VALUES.includes(normalized)) {
    throw new Error(`Test case status must be one of: ${TEST_CASE_STATUS_VALUES.join(", ")}`);
  }

  return normalized;
};

const normalizeGroupKind = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  const canonical = normalized.toLowerCase().replace(/[^a-z]/g, "");

  if (canonical === "local" || canonical === "grouped") {
    return "local";
  }

  if (canonical === "reusable" || canonical === "shared" || canonical === "sharedgroup" || canonical === "snapshot") {
    return "reusable";
  }

  return null;
};

const normalizeSteps = (steps = []) => {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps
    .map((step, index) => ({
      step_order: Number.isFinite(Number(step?.step_order)) ? Number(step.step_order) : index + 1,
      action: normalizeText(step?.action),
      expected_result: normalizeText(step?.expected_result || step?.expectedResult),
      group_id: normalizeText(step?.group_id || step?.groupId),
      group_name: normalizeText(step?.group_name || step?.groupName),
      group_kind: normalizeGroupKind(step?.group_kind || step?.groupKind || (step?.group_id || step?.groupId ? "local" : null)),
      reusable_group_id: normalizeText(step?.reusable_group_id || step?.reusableGroupId)
    }))
    .filter((step) => step.action || step.expected_result)
    .sort((left, right) => left.step_order - right.step_order)
    .map((step, index) => ({
      ...step,
      step_order: index + 1
    }));
};

const splitImportSequence = (value) => {
  if (value === undefined || value === null) {
    return [];
  }

  return String(value)
    .split(/\r?\n|\|/)
    .map((item) => item.trim());
};

const pickImportSequenceValue = (items, index) => {
  if (!items.length) {
    return null;
  }

  if (index < items.length) {
    return normalizeText(items[index]);
  }

  if (items.length === 1) {
    return normalizeText(items[0]);
  }

  return null;
};

const buildStepsFromImportRow = (row) => {
  const actions = splitImportSequence(row.action);
  const expectedResults = splitImportSequence(row.expected_result || row.expectedResult);
  const groupNames = splitImportSequence(row.step_group_name || row.stepGroupName);
  const groupKinds = splitImportSequence(row.step_group_kind || row.stepGroupKind);
  const sharedGroupIds = splitImportSequence(row.shared_group_id || row.sharedGroupId || row.reusable_group_id || row.reusableGroupId);

  if (!actions.length && !expectedResults.length && !groupNames.length && !groupKinds.length && !sharedGroupIds.length) {
    return [];
  }

  const size = Math.max(actions.length, expectedResults.length, groupNames.length, groupKinds.length, sharedGroupIds.length, 1);
  let previousGroupSignature = null;
  let currentGroupId = null;

  return Array.from({ length: size }, (_, index) => {
    const action = pickImportSequenceValue(actions, index);
    const expectedResult = pickImportSequenceValue(expectedResults, index);
    const groupName = pickImportSequenceValue(groupNames, index);
    const reusableGroupId = pickImportSequenceValue(sharedGroupIds, index);
    const groupKind =
      normalizeGroupKind(pickImportSequenceValue(groupKinds, index)) ||
      (reusableGroupId ? "reusable" : groupName ? "local" : null);
    const hasGroupMetadata = Boolean(groupName || reusableGroupId || groupKind);
    const groupSignature = hasGroupMetadata ? `${groupKind || "local"}::${groupName || ""}::${reusableGroupId || ""}` : null;

    if (groupSignature && groupSignature !== previousGroupSignature) {
      currentGroupId = uuid();
    } else if (!groupSignature) {
      currentGroupId = null;
    }

    previousGroupSignature = groupSignature;

    return {
      step_order: index + 1,
      action: action || "",
      expected_result: expectedResult || "",
      group_id: currentGroupId,
      group_name: groupName,
      group_kind: groupKind,
      reusable_group_id: reusableGroupId
    };
  }).filter((step) => step.action || step.expected_result);
};

const ensureAppTypeExists = async (appTypeId) => {
  if (!appTypeId) {
    return null;
  }

  const appType = await selectAppType.get(appTypeId);

  if (!appType) {
    throw new Error("App type not found");
  }

  return appType;
};

const ensureRequirementsExist = async (requirementIds = [], appTypeProjectId = null) => {
  for (const requirementId of requirementIds) {
    const requirement = await selectRequirement.get(requirementId);

    if (!requirement) {
      throw new Error("Requirement not found");
    }

    if (appTypeProjectId && requirement.project_id !== appTypeProjectId) {
      throw new Error("Requirements must belong to the same project as the selected app type");
    }
  }
};

const ensureSuitesMatchAppType = async (suiteIds = [], appTypeId = null) => {
  let resolvedAppTypeId = appTypeId;

  for (const suiteId of suiteIds) {
    const suite = await selectSuite.get(suiteId);

    if (!suite) {
      throw new Error("Test suite not found");
    }

    if (!resolvedAppTypeId) {
      resolvedAppTypeId = suite.app_type_id;
      continue;
    }

    if (suite.app_type_id !== resolvedAppTypeId) {
      throw new Error("All suites must belong to the selected app type");
    }
  }

  return resolvedAppTypeId;
};

const syncSuiteMappings = async (testCaseId, suiteIds = []) => {
  await deleteSuiteMappings.run(testCaseId);

  for (const [index, suiteId] of suiteIds.entries()) {
    await insertSuiteMapping.run(suiteId, testCaseId, index + 1);
  }
};

const syncRequirementMappings = async (testCaseId, requirementIds = []) => {
  await deleteRequirementMappings.run(testCaseId);

  for (const requirementId of requirementIds) {
    await insertRequirementMapping.run(requirementId, testCaseId);
  }
};

const createPersistablePayload = async ({
  app_type_id,
  suite_id,
  suite_ids = [],
  title,
  description,
  priority,
  status,
  requirement_id,
  requirement_ids = [],
  steps = []
}) => {
  const resolvedTitle = normalizeText(title);

  if (!resolvedTitle) {
    throw new Error("Test case title is required");
  }

  let resolvedAppTypeId = normalizeText(app_type_id);
  const resolvedSuiteIds = normalizeTextList([suite_id, ...suite_ids]);
  const resolvedRequirementIds = normalizeTextList([requirement_id, ...requirement_ids]);

  const appType = await ensureAppTypeExists(resolvedAppTypeId);
  resolvedAppTypeId = await ensureSuitesMatchAppType(resolvedSuiteIds, resolvedAppTypeId);
  const resolvedAppType = resolvedAppTypeId !== appType?.id ? await ensureAppTypeExists(resolvedAppTypeId) : appType;
  await ensureRequirementsExist(resolvedRequirementIds, resolvedAppType?.project_id || null);

  return {
    app_type_id: resolvedAppTypeId,
    suite_ids: resolvedSuiteIds,
    requirement_ids: resolvedRequirementIds,
    title: resolvedTitle,
    description: normalizeText(description),
    priority: normalizePriority(priority),
    status: normalizeStatus(status),
    steps: normalizeSteps(steps)
  };
};

const createOne = db.transaction(async (payload) => {
  const id = uuid();

  await insertTestCaseRecord.run(
    id,
    payload.app_type_id,
    payload.suite_ids[0] || null,
    payload.title,
    payload.description,
    payload.priority,
    payload.status,
    payload.requirement_ids[0] || null
  );

  await syncSuiteMappings(id, payload.suite_ids);
  await syncRequirementMappings(id, payload.requirement_ids);

  for (const step of payload.steps) {
    await insertStep.run(
      uuid(),
      id,
      step.step_order,
      step.action,
      step.expected_result,
      step.group_id,
      step.group_name,
      step.group_kind,
      step.reusable_group_id
    );
  }

  return { id };
});

exports.createTestCase = async (input) => {
  const payload = await createPersistablePayload(input);
  const response = await createOne(payload);
  const sharedGroupTargets = payload.steps
    .filter((step) => step.reusable_group_id && step.group_id)
    .reduce((targets, step) => {
      const key = `${step.reusable_group_id}::${step.group_id}`;

      if (targets.some((target) => target.key === key)) {
        return targets;
      }

      targets.push({
        key,
        reusable_group_id: step.reusable_group_id,
        group_id: step.group_id
      });
      return targets;
    }, []);

  for (const target of sharedGroupTargets) {
    await sharedStepSyncService.syncSharedGroupFromReference(
      target.reusable_group_id,
      response.id,
      target.group_id
    );
  }

  return response;
};

exports.bulkImportTestCases = async ({ app_type_id, requirement_id, rows = [] }) => {
  const resolvedAppTypeId = normalizeText(app_type_id);
  const defaultRequirementId = normalizeText(requirement_id);
  const sharedGroupCache = new Map();

  if (!resolvedAppTypeId) {
    throw new Error("app_type_id is required");
  }

  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("At least one CSV row is required");
  }

  await ensureAppTypeExists(resolvedAppTypeId);

  if (defaultRequirementId) {
    await ensureRequirementsExist([defaultRequirementId]);
  }

  const created = [];
  const errors = [];

  for (const [index, row] of rows.entries()) {
    try {
      const importedSteps = buildStepsFromImportRow(row || {}).map((step) => ({ ...step }));

      for (const step of importedSteps) {
        if (step.group_kind !== "reusable") {
          continue;
        }

        if (!step.reusable_group_id) {
          step.group_kind = step.group_id ? "local" : null;
          continue;
        }

        if (!sharedGroupCache.has(step.reusable_group_id)) {
          sharedGroupCache.set(step.reusable_group_id, await selectSharedStepGroup.get(step.reusable_group_id));
        }

        const sharedGroup = sharedGroupCache.get(step.reusable_group_id);

        if (!sharedGroup || sharedGroup.app_type_id !== resolvedAppTypeId) {
          step.group_kind = step.group_id ? "local" : null;
          step.reusable_group_id = null;
          continue;
        }

        if (!step.group_name) {
          step.group_name = sharedGroup.name;
        }
      }

      const response = await exports.createTestCase({
        app_type_id: resolvedAppTypeId,
        title: row?.title,
        description: row?.description,
        priority: row?.priority,
        status: normalizeStatus(row?.status, "draft"),
        requirement_ids: normalizeTextList([defaultRequirementId, row?.requirement_id, row?.requirementId]),
        steps: importedSteps
      });

      created.push({
        row: index + 1,
        id: response.id,
        title: normalizeText(row?.title) || "Untitled test case"
      });
    } catch (error) {
      errors.push({
        row: index + 1,
        title: normalizeText(row?.title),
        message: error.message || "Unable to import test case"
      });
    }
  }

  return {
    imported: created.length,
    failed: errors.length,
    created,
    errors
  };
};

exports.getTestCases = async ({ suite_id, requirement_id, status, app_type_id }) => {
  let query = `SELECT DISTINCT test_cases.* FROM test_cases`;
  const joins = [];
  const where = [`1=1`];
  const params = [];

  if (suite_id) {
    joins.push(`JOIN suite_test_cases ON suite_test_cases.test_case_id = test_cases.id`);
    joins.push(`JOIN test_suites ON test_suites.id = suite_test_cases.suite_id`);
  }

  if (requirement_id) {
    joins.push(`JOIN requirement_test_cases ON requirement_test_cases.test_case_id = test_cases.id`);
  }

  if (suite_id) {
    where.push(`suite_test_cases.suite_id = ?`);
    params.push(suite_id);
  }

  if (app_type_id) {
    where.push(`test_cases.app_type_id = ?`);
    params.push(app_type_id);
  }

  if (requirement_id) {
    where.push(`requirement_test_cases.requirement_id = ?`);
    params.push(requirement_id);
  }

  if (status) {
    where.push(`test_cases.status = ?`);
    params.push(status);
  }

  if (joins.length) {
    query += ` ${joins.join(" ")}`;
  }

  query += ` WHERE ${where.join(" AND ")}`;
  query += suite_id
    ? ` ORDER BY suite_test_cases.sort_order ASC, test_cases.created_at DESC`
    : ` ORDER BY test_cases.created_at DESC`;

  const rows = await db.prepare(query).all(...params);
  return Promise.all(rows.map(hydrateSuiteIds));
};

exports.getTestCase = async (id) => {
  const testCase = await db.prepare(`
    SELECT *
    FROM test_cases
    WHERE id = ?
  `).get(id);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  return hydrateSuiteIds(testCase);
};

exports.updateTestCase = async (id, data) => {
  const existing = await exports.getTestCase(id);

  const requestedSuiteIds = data.suite_ids !== undefined
    ? normalizeTextList(data.suite_ids)
    : data.suite_id !== undefined
      ? normalizeTextList([data.suite_id, ...(existing.suite_ids || []).filter((suiteId) => suiteId !== data.suite_id)])
      : existing.suite_ids || [];
  const requestedRequirementIds = data.requirement_ids !== undefined
    ? normalizeTextList(data.requirement_ids)
    : data.requirement_id !== undefined
      ? normalizeTextList([data.requirement_id])
      : existing.requirement_ids || [];

  let resolvedAppTypeId = normalizeText(data.app_type_id) || existing.app_type_id || null;

  const resolvedAppType = await ensureAppTypeExists(resolvedAppTypeId);
  resolvedAppTypeId = await ensureSuitesMatchAppType(requestedSuiteIds, resolvedAppTypeId);
  const finalAppType = resolvedAppTypeId !== resolvedAppType?.id ? await ensureAppTypeExists(resolvedAppTypeId) : resolvedAppType;
  await ensureRequirementsExist(requestedRequirementIds, finalAppType?.project_id || null);

  const payload = {
    app_type_id: resolvedAppTypeId,
    suite_ids: requestedSuiteIds,
    requirement_ids: requestedRequirementIds,
    title: normalizeText(data.title) || existing.title,
    description: data.description !== undefined ? normalizeText(data.description) : existing.description,
    priority: data.priority !== undefined ? normalizePriority(data.priority) : existing.priority ?? DEFAULT_PRIORITY,
    status: data.status !== undefined ? normalizeStatus(data.status) : existing.status || DEFAULT_STATUS
  };

  const executeUpdate = db.transaction(async () => {
    await updateTestCaseRecord.run(
      payload.app_type_id,
      payload.suite_ids[0] || null,
      payload.title,
      payload.description,
      payload.priority,
      payload.status,
      payload.requirement_ids[0] || null,
      id
    );

    if (data.suite_ids !== undefined || data.suite_id !== undefined) {
      await syncSuiteMappings(id, payload.suite_ids);
    }

    if (data.requirement_ids !== undefined || data.requirement_id !== undefined) {
      await syncRequirementMappings(id, payload.requirement_ids);
    }
  });

  await executeUpdate();

  return { updated: true };
};

exports.deleteTestCase = async (id) => {
  await exports.getTestCase(id);

  const executeDelete = db.transaction(async () => {
    await deleteStepsForTestCase.run(id);
    await deleteRequirementMappings.run(id);
    await deleteSuiteMappings.run(id);
    await deleteTestCaseRecord.run(id);
  });

  await executeDelete();

  return { deleted: true };
};
