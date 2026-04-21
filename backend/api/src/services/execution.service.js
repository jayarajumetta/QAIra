const db = require("../db");
const { v4: uuid } = require("uuid");
const { sanitizeVariablesForRead } = require("../utils/contextVariables");

const DIRECT_CASE_SUITE_ID = "default";
const DIRECT_CASE_SUITE_NAME = "Default";

const getSuiteIdsForExecution = db.prepare(`
  SELECT suite_id, suite_name
  FROM execution_suites
  WHERE execution_id = ?
  ORDER BY suite_id ASC
`);

const getCaseSnapshotsForExecution = db.prepare(`
  SELECT execution_id, test_case_id, test_case_title, test_case_description, suite_id, suite_name, priority, status, parameter_values, sort_order, assigned_to
  FROM execution_case_snapshots
  WHERE execution_id = ?
  ORDER BY sort_order ASC, test_case_title ASC
`);

const getStepSnapshotsForExecution = db.prepare(`
  SELECT execution_id, test_case_id, snapshot_step_id, step_order, action, expected_result, step_type, automation_code, api_request, group_id, group_name, group_kind, reusable_group_id
  FROM execution_step_snapshots
  WHERE execution_id = ?
  ORDER BY test_case_id ASC, step_order ASC
`);

const getResultsForExecution = db.prepare(`
  SELECT test_case_id, status, created_at
  FROM execution_results
  WHERE execution_id = ?
  ORDER BY created_at DESC, id DESC
`);

const insertExecutionSuite = db.prepare(`
  INSERT INTO execution_suites (execution_id, suite_id, suite_name)
  VALUES (?, ?, ?)
`);

const insertExecutionCaseSnapshot = db.prepare(`
  INSERT INTO execution_case_snapshots (
    execution_id,
    test_case_id,
    test_case_title,
    test_case_description,
    suite_id,
    suite_name,
    priority,
    status,
    parameter_values,
    sort_order,
    assigned_to
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertExecutionStepSnapshot = db.prepare(`
  INSERT INTO execution_step_snapshots (
    execution_id,
    test_case_id,
    snapshot_step_id,
    step_order,
    action,
    expected_result,
    step_type,
    automation_code,
    api_request,
    group_id,
    group_name,
    group_kind,
    reusable_group_id
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const validateSuite = db.prepare(`
  SELECT id, app_type_id, name
  FROM test_suites
  WHERE id = ?
`);

const selectCasesForSuite = db.prepare(`
  SELECT
    test_cases.id AS test_case_id,
    test_cases.title AS test_case_title,
    test_cases.description AS test_case_description,
    test_cases.parameter_values,
    test_cases.priority,
    test_cases.status,
    suite_test_cases.sort_order
  FROM suite_test_cases
  JOIN test_cases ON test_cases.id = suite_test_cases.test_case_id
  WHERE suite_test_cases.suite_id = ?
  ORDER BY suite_test_cases.sort_order ASC, test_cases.created_at DESC
`);

const selectCaseForExecution = db.prepare(`
  SELECT
    id AS test_case_id,
    app_type_id,
    title AS test_case_title,
    description AS test_case_description,
    parameter_values,
    priority,
    status
  FROM test_cases
  WHERE id = ?
`);

const selectTestEnvironment = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, base_url, browser, notes, variables
  FROM test_environments
  WHERE id = ?
`);

const selectTestConfiguration = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, browser, mobile_os, platform_version, variables
  FROM test_configurations
  WHERE id = ?
`);

const selectTestDataSet = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, mode, columns, rows
  FROM test_data_sets
  WHERE id = ?
`);

const selectExecutionAssignee = db.prepare(`
  SELECT id, email, name, avatar_data_url
  FROM users
  WHERE id = ?
`);

const selectExecutionRecord = db.prepare(`
  SELECT *
  FROM executions
  WHERE id = ?
`);

const selectExecutionCaseSnapshot = db.prepare(`
  SELECT execution_id, test_case_id, assigned_to
  FROM execution_case_snapshots
  WHERE execution_id = ? AND test_case_id = ?
`);

const updateExecutionAssignment = db.prepare(`
  UPDATE executions
  SET assigned_to = ?
  WHERE id = ?
`);

const updateExecutionCaseAssignment = db.prepare(`
  UPDATE execution_case_snapshots
  SET assigned_to = ?
  WHERE execution_id = ? AND test_case_id = ?
`);

const selectProjectMember = db.prepare(`
  SELECT id
  FROM project_members
  WHERE project_id = ? AND user_id = ?
`);

const selectStepsForCase = db.prepare(`
  SELECT id, step_order, action, expected_result, step_type, automation_code, api_request, group_id, group_name, group_kind, reusable_group_id
  FROM test_steps
  WHERE test_case_id = ?
  ORDER BY step_order ASC, id ASC
`);

function parseJsonValue(value, fallback) {
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
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeParameterValues(values = {}) {
  const parsed = parseJsonValue(values, {});

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return Object.entries(parsed).reduce((next, [key, value]) => {
    const normalizedKey = String(key || "").trim().replace(/^@+/, "").toLowerCase();

    if (!normalizedKey) {
      return next;
    }

    next[normalizedKey] = value === undefined || value === null ? "" : String(value);
    return next;
  }, {});
}

function shapeAssignedUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
    avatar_data_url: user.avatar_data_url || null
  };
}

function attachExecutionContext(execution) {
  if (!execution) {
    return execution;
  }

  const environmentSnapshot = parseJsonValue(execution.test_environment_snapshot, null);
  const configurationSnapshot = parseJsonValue(execution.test_configuration_snapshot, null);
  const dataSetSnapshot = parseJsonValue(execution.test_data_set_snapshot, null);

  return {
    ...execution,
    test_environment: execution.test_environment_name || environmentSnapshot
      ? {
          id: execution.test_environment_id || environmentSnapshot?.id || null,
          name: execution.test_environment_name || environmentSnapshot?.name || "Deleted environment",
          snapshot: environmentSnapshot
            ? {
                ...environmentSnapshot,
                variables: sanitizeVariablesForRead(environmentSnapshot.variables)
              }
            : null
        }
      : null,
    test_configuration: execution.test_configuration_name || configurationSnapshot
      ? {
          id: execution.test_configuration_id || configurationSnapshot?.id || null,
          name: execution.test_configuration_name || configurationSnapshot?.name || "Deleted configuration",
          snapshot: configurationSnapshot
            ? {
                ...configurationSnapshot,
                variables: sanitizeVariablesForRead(configurationSnapshot.variables)
              }
            : null
        }
      : null,
    test_data_set: execution.test_data_set_name || dataSetSnapshot
      ? {
          id: execution.test_data_set_id || dataSetSnapshot?.id || null,
          name: execution.test_data_set_name || dataSetSnapshot?.name || "Deleted data set",
          snapshot: dataSetSnapshot
        }
      : null
  };
}

async function attachExecutionAssignee(execution) {
  if (!execution) {
    return execution;
  }

  if (!execution.assigned_to) {
    return {
      ...execution,
      assigned_user: null
    };
  }

  const assignedUser = await selectExecutionAssignee.get(execution.assigned_to);

  return {
    ...execution,
    assigned_user: shapeAssignedUser(assignedUser)
  };
}

async function attachExecutionCaseAssignees(caseSnapshots) {
  if (!Array.isArray(caseSnapshots) || !caseSnapshots.length) {
    return [];
  }

  const userIds = [...new Set(caseSnapshots.map((snapshot) => snapshot.assigned_to).filter(Boolean))];
  const assignedUsersById = {};

  for (const userId of userIds) {
    assignedUsersById[userId] = shapeAssignedUser(await selectExecutionAssignee.get(userId));
  }

  return caseSnapshots.map((snapshot) => ({
    ...snapshot,
    assigned_user: snapshot.assigned_to ? assignedUsersById[snapshot.assigned_to] || null : null
  }));
}

async function validateExecutionAssignee(projectId, assignedTo) {
  if (!assignedTo) {
    return null;
  }

  const assignedUser = await selectExecutionAssignee.get(assignedTo);

  if (!assignedUser) {
    throw new Error("Assigned user not found");
  }

  const member = await selectProjectMember.get(projectId, assignedTo);

  if (!member) {
    throw new Error("Assigned user must be a member of the selected project");
  }

  return assignedUser;
}

async function resolveExecutionContextResource({ id, label, projectId, appTypeId, lookup, snapshotBuilder }) {
  if (!id) {
    return null;
  }

  const resource = await lookup.get(id);

  if (!resource) {
    throw new Error(`${label} not found`);
  }

  if (resource.project_id !== projectId) {
    throw new Error(`${label} must belong to the selected project`);
  }

  if (resource.app_type_id && resource.app_type_id !== appTypeId) {
    throw new Error(`${label} must belong to the selected app type or be shared at project level`);
  }

  return {
    id: resource.id,
    name: resource.name,
    snapshot: snapshotBuilder(resource)
  };
}

async function buildSnapshotPayload(executionId, suiteRows, options = {}) {
  const seenCaseIds = new Set();
  const caseSnapshots = [];
  const stepSnapshots = [];
  let sortOrder = 0;

  for (const suiteRow of suiteRows) {
    const suiteCases = await selectCasesForSuite.all(suiteRow.suite_id);

    for (const suiteCase of suiteCases) {
      if (seenCaseIds.has(suiteCase.test_case_id)) {
        continue;
      }

      seenCaseIds.add(suiteCase.test_case_id);
      sortOrder += 1;

      caseSnapshots.push({
        execution_id: executionId,
        test_case_id: suiteCase.test_case_id,
        test_case_title: suiteCase.test_case_title,
        test_case_description: suiteCase.test_case_description,
        suite_id: suiteRow.suite_id,
        suite_name: suiteRow.suite_name,
        priority: suiteCase.priority,
        status: suiteCase.status,
        parameter_values: normalizeParameterValues(suiteCase.parameter_values),
        sort_order: sortOrder
      });

      const steps = await selectStepsForCase.all(suiteCase.test_case_id);

      for (const step of steps) {
        stepSnapshots.push({
          execution_id: executionId,
          test_case_id: suiteCase.test_case_id,
          snapshot_step_id: options.persisted
            ? uuid()
            : `${executionId}:${suiteCase.test_case_id}:${step.id}`,
          step_order: step.step_order,
          action: step.action,
          expected_result: step.expected_result,
          step_type: step.step_type,
          automation_code: step.automation_code,
          api_request: step.api_request,
          group_id: step.group_id,
          group_name: step.group_name,
          group_kind: step.group_kind,
          reusable_group_id: step.reusable_group_id
        });
      }
    }
  }

  const directCases = Array.isArray(options.directCases) ? options.directCases : [];
  const directSuiteRow = options.directSuiteRow || null;

  if (directSuiteRow && directCases.length) {
    for (const directCase of directCases) {
      if (seenCaseIds.has(directCase.test_case_id)) {
        continue;
      }

      seenCaseIds.add(directCase.test_case_id);
      sortOrder += 1;

      caseSnapshots.push({
        execution_id: executionId,
        test_case_id: directCase.test_case_id,
        test_case_title: directCase.test_case_title,
        test_case_description: directCase.test_case_description,
        suite_id: directSuiteRow.suite_id,
        suite_name: directSuiteRow.suite_name,
        priority: directCase.priority,
        status: directCase.status,
        parameter_values: normalizeParameterValues(directCase.parameter_values),
        sort_order: sortOrder
      });

      const steps = await selectStepsForCase.all(directCase.test_case_id);

      for (const step of steps) {
        stepSnapshots.push({
          execution_id: executionId,
          test_case_id: directCase.test_case_id,
          snapshot_step_id: options.persisted
            ? uuid()
            : `${executionId}:${directCase.test_case_id}:${step.id}`,
          step_order: step.step_order,
          action: step.action,
          expected_result: step.expected_result,
          step_type: step.step_type,
          automation_code: step.automation_code,
          api_request: step.api_request,
          group_id: step.group_id,
          group_name: step.group_name,
          group_kind: step.group_kind,
          reusable_group_id: step.reusable_group_id
        });
      }
    }
  }

  return {
    caseSnapshots,
    stepSnapshots
  };
}

async function attachScope(execution) {
  if (!execution) {
    return execution;
  }

  const executionWithMetadata = await attachExecutionAssignee(attachExecutionContext(execution));
  const suiteRows = await getSuiteIdsForExecution.all(execution.id);
  const suite_ids = suiteRows.map((row) => row.suite_id);

  return {
    ...executionWithMetadata,
    suite_ids,
    suite_snapshots: suiteRows.map((row) => ({ id: row.suite_id, name: row.suite_name || "Deleted Suite" }))
  };
}

async function attachDetailedScope(execution) {
  if (!execution) {
    return execution;
  }

  const hydrated = await attachScope(execution);
  const suiteRows = await getSuiteIdsForExecution.all(execution.id);
  const storedCaseSnapshots = await getCaseSnapshotsForExecution.all(execution.id);
  const storedStepSnapshots = await getStepSnapshotsForExecution.all(execution.id);
  const hydratedCaseSnapshots = await attachExecutionCaseAssignees(storedCaseSnapshots);

  if (storedCaseSnapshots.length || storedStepSnapshots.length || !suiteRows.length) {
    return {
      ...hydrated,
      case_snapshots: hydratedCaseSnapshots,
      step_snapshots: storedStepSnapshots
    };
  }

  const liveSnapshotPayload = await buildSnapshotPayload(
    execution.id,
    suiteRows.map((row) => ({
      suite_id: row.suite_id,
      suite_name: row.suite_name || "Deleted Suite"
    }))
  );

  return {
    ...hydrated,
    case_snapshots: await attachExecutionCaseAssignees(liveSnapshotPayload.caseSnapshots),
    step_snapshots: liveSnapshotPayload.stepSnapshots
  };
}

exports.createExecution = async ({
  project_id,
  app_type_id,
  suite_ids = [],
  test_case_ids = [],
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  assigned_to,
  name,
  created_by
}) => {
  if (!project_id || !created_by) {
    throw new Error("Missing required fields");
  }

  const project = await db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);

  if (!project) throw new Error("Project not found");

  const user = await db.prepare(`
    SELECT id FROM users WHERE id = ?
  `).get(created_by);

  if (!user) throw new Error("Invalid user");

  await validateExecutionAssignee(project_id, assigned_to);

  if (app_type_id) {
    const appType = await db.prepare(`
      SELECT id, project_id FROM app_types WHERE id = ?
    `).get(app_type_id);

    if (!appType) throw new Error("App type not found");
    if (appType.project_id !== project_id) {
      throw new Error("App type must belong to the selected project");
    }
  }

  const selectedEnvironment = await resolveExecutionContextResource({
    id: test_environment_id,
    label: "Test environment",
    projectId: project_id,
    appTypeId: app_type_id || null,
    lookup: selectTestEnvironment,
    snapshotBuilder: (resource) => ({
      id: resource.id,
      name: resource.name,
      description: resource.description,
      base_url: resource.base_url,
      browser: resource.browser,
      notes: resource.notes,
      variables: parseJsonValue(resource.variables, [])
    })
  });
  const selectedConfiguration = await resolveExecutionContextResource({
    id: test_configuration_id,
    label: "Test configuration",
    projectId: project_id,
    appTypeId: app_type_id || null,
    lookup: selectTestConfiguration,
    snapshotBuilder: (resource) => ({
      id: resource.id,
      name: resource.name,
      description: resource.description,
      browser: resource.browser,
      mobile_os: resource.mobile_os,
      platform_version: resource.platform_version,
      variables: parseJsonValue(resource.variables, [])
    })
  });
  const selectedDataSet = await resolveExecutionContextResource({
    id: test_data_set_id,
    label: "Test data set",
    projectId: project_id,
    appTypeId: app_type_id || null,
    lookup: selectTestDataSet,
    snapshotBuilder: (resource) => ({
      id: resource.id,
      name: resource.name,
      description: resource.description,
      mode: resource.mode,
      columns: parseJsonValue(resource.columns, []),
      rows: parseJsonValue(resource.rows, [])
    })
  });

  const uniqueSuiteIds = [...new Set(suite_ids)];
  const uniqueTestCaseIds = [...new Set(test_case_ids)];

  if ((uniqueSuiteIds.length || uniqueTestCaseIds.length) && !app_type_id) {
    throw new Error("app_type_id is required when scope is provided");
  }

  const suiteRows = [];

  for (const suiteId of uniqueSuiteIds) {
    const suite = await validateSuite.get(suiteId);

    if (!suite) {
      throw new Error(`Suite not found: ${suiteId}`);
    }

    if (suite.app_type_id !== app_type_id) {
      throw new Error("All suites must belong to the selected app type");
    }

    suiteRows.push({
      suite_id: suite.id,
      suite_name: suite.name
    });
  }

  const directCaseRows = [];

  for (const testCaseId of uniqueTestCaseIds) {
    const testCase = await selectCaseForExecution.get(testCaseId);

    if (!testCase) {
      throw new Error(`Test case not found: ${testCaseId}`);
    }

    if (testCase.app_type_id !== app_type_id) {
      throw new Error("All test cases must belong to the selected app type");
    }

    directCaseRows.push(testCase);
  }

  const directSuiteRow = directCaseRows.length
    ? {
        suite_id: DIRECT_CASE_SUITE_ID,
        suite_name: DIRECT_CASE_SUITE_NAME
      }
    : null;
  const executionSuiteRows = directSuiteRow ? [...suiteRows, directSuiteRow] : suiteRows;

  const id = uuid();

  const transaction = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO executions
      (
        id,
        project_id,
        app_type_id,
        name,
        trigger,
        status,
        test_environment_id,
        test_environment_name,
        test_environment_snapshot,
        test_configuration_id,
        test_configuration_name,
        test_configuration_snapshot,
        test_data_set_id,
        test_data_set_name,
        test_data_set_snapshot,
        assigned_to,
        created_by
      )
      VALUES (?, ?, ?, ?, 'manual', 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      project_id,
      app_type_id || null,
      name || "Execution Run",
      selectedEnvironment?.id || null,
      selectedEnvironment?.name || null,
      selectedEnvironment?.snapshot || null,
      selectedConfiguration?.id || null,
      selectedConfiguration?.name || null,
      selectedConfiguration?.snapshot || null,
      selectedDataSet?.id || null,
      selectedDataSet?.name || null,
      selectedDataSet?.snapshot || null,
      assigned_to || null,
      created_by
    );

    for (const suiteRow of executionSuiteRows) {
      await insertExecutionSuite.run(id, suiteRow.suite_id, suiteRow.suite_name);
    }

    const snapshotPayload = await buildSnapshotPayload(id, suiteRows, {
      persisted: true,
      directCases: directCaseRows,
      directSuiteRow
    });

    for (const caseSnapshot of snapshotPayload.caseSnapshots) {
      await insertExecutionCaseSnapshot.run(
        caseSnapshot.execution_id,
        caseSnapshot.test_case_id,
        caseSnapshot.test_case_title,
        caseSnapshot.test_case_description,
        caseSnapshot.suite_id,
        caseSnapshot.suite_name,
        caseSnapshot.priority,
        caseSnapshot.status,
        caseSnapshot.parameter_values || {},
        caseSnapshot.sort_order,
        caseSnapshot.assigned_to || null
      );
    }

    for (const stepSnapshot of snapshotPayload.stepSnapshots) {
      await insertExecutionStepSnapshot.run(
        stepSnapshot.execution_id,
        stepSnapshot.test_case_id,
        stepSnapshot.snapshot_step_id,
        stepSnapshot.step_order,
        stepSnapshot.action,
        stepSnapshot.expected_result,
        stepSnapshot.step_type,
        stepSnapshot.automation_code,
        stepSnapshot.api_request,
        stepSnapshot.group_id,
        stepSnapshot.group_name,
        stepSnapshot.group_kind,
        stepSnapshot.reusable_group_id
      );
    }
  });

  await transaction();

  return { id };
};

exports.getExecutions = async ({ project_id, app_type_id, status }) => {
  let query = `SELECT * FROM executions WHERE 1=1`;
  const params = [];

  if (project_id) {
    query += ` AND project_id = ?`;
    params.push(project_id);
  }

  if (app_type_id) {
    query += ` AND app_type_id = ?`;
    params.push(app_type_id);
  }

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  query += ` ORDER BY started_at DESC, ended_at DESC, id DESC`;

  const rows = await db.prepare(query).all(...params);
  return Promise.all(rows.map(attachScope));
};

exports.getExecution = async (id) => {
  const execution = await selectExecutionRecord.get(id);

  if (!execution) throw new Error("Execution not found");

  return attachDetailedScope(execution);
};

exports.rerunExecution = async (id, { failed_only = false, created_by, name } = {}) => {
  if (!created_by) {
    throw new Error("created_by is required");
  }

  const sourceExecution = await exports.getExecution(id);
  const sourceCaseSnapshots = sourceExecution.case_snapshots || [];
  const sourceStepSnapshots = sourceExecution.step_snapshots || [];
  const sourceSuiteSnapshots = sourceExecution.suite_snapshots || [];

  if (!sourceCaseSnapshots.length) {
    throw new Error("This execution does not contain any snapped cases to rerun.");
  }

  let filteredCaseSnapshots = sourceCaseSnapshots;

  if (failed_only) {
    const latestStatusByCaseId = new Map();
    const executionResults = await getResultsForExecution.all(id);

    executionResults.forEach((result) => {
      if (!latestStatusByCaseId.has(result.test_case_id)) {
        latestStatusByCaseId.set(result.test_case_id, result.status);
      }
    });

    const failedCaseIds = new Set(
      [...latestStatusByCaseId.entries()]
        .filter(([, status]) => status === "failed")
        .map(([test_case_id]) => test_case_id)
    );

    filteredCaseSnapshots = sourceCaseSnapshots.filter((snapshot) => failedCaseIds.has(snapshot.test_case_id));

    if (!filteredCaseSnapshots.length) {
      throw new Error("This execution does not have any failed cases to rerun.");
    }
  }

  const nextExecutionId = uuid();
  const allowedCaseIds = new Set(filteredCaseSnapshots.map((snapshot) => snapshot.test_case_id));
  const filteredSuiteSnapshots = sourceSuiteSnapshots.filter((suite) =>
    filteredCaseSnapshots.some((snapshot) => snapshot.suite_id === suite.id)
  );
  const filteredStepSnapshots = sourceStepSnapshots.filter((snapshot) => allowedCaseIds.has(snapshot.test_case_id));
  const rerunName =
    normalizeText(name) ||
    `${sourceExecution.name || "Execution Run"}${failed_only ? " Failed Rerun" : " Rerun"}`;

  const transaction = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO executions
      (
        id,
        project_id,
        app_type_id,
        name,
        trigger,
        status,
        test_environment_id,
        test_environment_name,
        test_environment_snapshot,
        test_configuration_id,
        test_configuration_name,
        test_configuration_snapshot,
        test_data_set_id,
        test_data_set_name,
        test_data_set_snapshot,
        assigned_to,
        created_by
      )
      VALUES (?, ?, ?, ?, 'manual', 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nextExecutionId,
      sourceExecution.project_id,
      sourceExecution.app_type_id || null,
      rerunName,
      sourceExecution.test_environment?.id || null,
      sourceExecution.test_environment?.name || null,
      sourceExecution.test_environment?.snapshot || null,
      sourceExecution.test_configuration?.id || null,
      sourceExecution.test_configuration?.name || null,
      sourceExecution.test_configuration?.snapshot || null,
      sourceExecution.test_data_set?.id || null,
      sourceExecution.test_data_set?.name || null,
      sourceExecution.test_data_set?.snapshot || null,
      sourceExecution.assigned_to || null,
      created_by
    );

    for (const suite of filteredSuiteSnapshots) {
      await insertExecutionSuite.run(nextExecutionId, suite.id, suite.name || "Deleted Suite");
    }

    for (const [index, snapshot] of filteredCaseSnapshots.entries()) {
      await insertExecutionCaseSnapshot.run(
        nextExecutionId,
        snapshot.test_case_id,
        snapshot.test_case_title,
        snapshot.test_case_description,
        snapshot.suite_id,
        snapshot.suite_name,
        snapshot.priority,
        snapshot.status,
        snapshot.parameter_values || {},
        index + 1,
        snapshot.assigned_to || null
      );
    }

    for (const snapshot of filteredStepSnapshots) {
      await insertExecutionStepSnapshot.run(
        nextExecutionId,
        snapshot.test_case_id,
        uuid(),
        snapshot.step_order,
        snapshot.action,
        snapshot.expected_result,
        snapshot.step_type,
        snapshot.automation_code,
        snapshot.api_request,
        snapshot.group_id,
        snapshot.group_name,
        snapshot.group_kind,
        snapshot.reusable_group_id
      );
    }
  });

  await transaction();

  return { id: nextExecutionId };
};

exports.startExecution = async (id) => {
  const execution = await exports.getExecution(id);

  if (execution.status !== "queued") {
    throw new Error("Only queued executions can be started");
  }

  await db.prepare(`
    UPDATE executions
    SET status = 'running', started_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);

  return { started: true };
};

exports.completeExecution = async (id, status) => {
  if (!["completed", "failed"].includes(status)) {
    throw new Error("Invalid completion status");
  }

  const execution = await exports.getExecution(id);

  if (execution.status !== "running") {
    throw new Error("Only running executions can be completed");
  }

  await db.prepare(`
    UPDATE executions
    SET status = ?, ended_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, id);

  return { completed: true };
};

exports.updateExecution = async (id, input = {}) => {
  if (!Object.prototype.hasOwnProperty.call(input, "assigned_to")) {
    throw new Error("assigned_to is required");
  }

  const execution = await selectExecutionRecord.get(id);

  if (!execution) {
    throw new Error("Execution not found");
  }

  const assignedTo = normalizeText(input.assigned_to);
  await validateExecutionAssignee(execution.project_id, assignedTo);
  await updateExecutionAssignment.run(assignedTo, id);

  return { updated: true };
};

exports.updateExecutionCaseAssignment = async (executionId, testCaseId, input = {}) => {
  if (!Object.prototype.hasOwnProperty.call(input, "assigned_to")) {
    throw new Error("assigned_to is required");
  }

  const execution = await selectExecutionRecord.get(executionId);

  if (!execution) {
    throw new Error("Execution not found");
  }

  const caseSnapshot = await selectExecutionCaseSnapshot.get(executionId, testCaseId);

  if (!caseSnapshot) {
    throw new Error("Execution test case not found");
  }

  const assignedTo = normalizeText(input.assigned_to);
  await validateExecutionAssignee(execution.project_id, assignedTo);
  await updateExecutionCaseAssignment.run(assignedTo, executionId, testCaseId);

  return { updated: true };
};

exports.deleteExecution = async (id) => {
  await exports.getExecution(id);

  const used = await db.prepare(`
    SELECT id FROM execution_results WHERE execution_id = ?
  `).get(id);

  if (used) {
    throw new Error("Cannot delete execution with results");
  }

  await db.prepare(`DELETE FROM execution_step_snapshots WHERE execution_id = ?`).run(id);
  await db.prepare(`DELETE FROM execution_case_snapshots WHERE execution_id = ?`).run(id);
  await db.prepare(`DELETE FROM execution_suites WHERE execution_id = ?`).run(id);
  await db.prepare(`DELETE FROM executions WHERE id = ?`).run(id);

  return { deleted: true };
};
