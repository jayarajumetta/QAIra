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
  SELECT execution_id, test_case_id, test_case_title, test_case_description, suite_id, suite_name, priority, status, sort_order
  FROM execution_case_snapshots
  WHERE execution_id = ?
  ORDER BY sort_order ASC, test_case_title ASC
`);

const getStepSnapshotsForExecution = db.prepare(`
  SELECT execution_id, test_case_id, snapshot_step_id, step_order, action, expected_result
  FROM execution_step_snapshots
  WHERE execution_id = ?
  ORDER BY test_case_id ASC, step_order ASC
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
    sort_order
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertExecutionStepSnapshot = db.prepare(`
  INSERT INTO execution_step_snapshots (
    execution_id,
    test_case_id,
    snapshot_step_id,
    step_order,
    action,
    expected_result
  )
  VALUES (?, ?, ?, ?, ?, ?)
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

const selectStepsForCase = db.prepare(`
  SELECT id, step_order, action, expected_result
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
          expected_result: step.expected_result
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
          expected_result: step.expected_result
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

  const suiteRows = await getSuiteIdsForExecution.all(execution.id);
  const suite_ids = suiteRows.map((row) => row.suite_id);

  return {
    ...attachExecutionContext(execution),
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

  if (storedCaseSnapshots.length || storedStepSnapshots.length || !suiteRows.length) {
    return {
      ...hydrated,
      case_snapshots: storedCaseSnapshots,
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
    case_snapshots: liveSnapshotPayload.caseSnapshots,
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
        created_by
      )
      VALUES (?, ?, ?, ?, 'manual', 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        caseSnapshot.sort_order
      );
    }

    for (const stepSnapshot of snapshotPayload.stepSnapshots) {
      await insertExecutionStepSnapshot.run(
        stepSnapshot.execution_id,
        stepSnapshot.test_case_id,
        stepSnapshot.snapshot_step_id,
        stepSnapshot.step_order,
        stepSnapshot.action,
        stepSnapshot.expected_result
      );
    }
  });

  await transaction();

  return { id };
};

exports.getExecutions = async ({ project_id, status }) => {
  let query = `SELECT * FROM executions WHERE 1=1`;
  const params = [];

  if (project_id) {
    query += ` AND project_id = ?`;
    params.push(project_id);
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
  const execution = await db.prepare(`
    SELECT * FROM executions WHERE id = ?
  `).get(id);

  if (!execution) throw new Error("Execution not found");

  return attachDetailedScope(execution);
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
