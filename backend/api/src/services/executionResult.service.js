const db = require("../db");
const { v4: uuid } = require("uuid");

const VALID_STATUS = ["passed", "failed", "blocked"];

const getPrimarySuiteForTestCase = db.prepare(`
  SELECT test_suites.id, test_suites.name
  FROM suite_test_cases
  JOIN test_suites ON test_suites.id = suite_test_cases.suite_id
  WHERE suite_test_cases.test_case_id = ?
  ORDER BY suite_test_cases.sort_order ASC
  LIMIT 1
`);

// Create Result
exports.createExecutionResult = async (data) => {

  const {
    execution_id,
    test_case_id,
    app_type_id,
    status,
    duration_ms,
    error,
    logs,
    executed_by
  } = data;

  if (!VALID_STATUS.includes(status)) {
    throw new Error("Invalid status");
  }

  // Validate execution
  const execution = await db.prepare(`
    SELECT id FROM executions WHERE id = ?
  `).get(execution_id);

  if (!execution) throw new Error("Execution not found");

  // Validate test case
  const testCase = await db.prepare(`
    SELECT id, title, suite_id
    FROM test_cases
    WHERE id = ?
  `).get(test_case_id);

  if (!testCase) throw new Error("Test case not found");

  // Validate app type
  const appType = await db.prepare(`
    SELECT id FROM app_types WHERE id = ?
  `).get(app_type_id);

  if (!appType) throw new Error("App type not found");

  // Optional: Validate user
  if (executed_by) {
    const user = await db.prepare(`
      SELECT id FROM users WHERE id = ?
    `).get(executed_by);

    if (!user) throw new Error("Invalid user");
  }

  const suiteSnapshot = await getPrimarySuiteForTestCase.get(test_case_id);
  const id = uuid();

  await db.prepare(`
    INSERT INTO execution_results
    (id, execution_id, test_case_id, test_case_title, suite_id, suite_name, app_type_id, status, duration_ms, error, logs, executed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    execution_id,
    test_case_id,
    testCase.title,
    suiteSnapshot?.id || testCase.suite_id || null,
    suiteSnapshot?.name || null,
    app_type_id,
    status,
    duration_ms || null,
    error || null,
    logs || null,
    executed_by || null
  );

  return { id };
};


// Get Results (with filters)
exports.getExecutionResults = async ({ execution_id, test_case_id, app_type_id }) => {

  let query = `SELECT * FROM execution_results WHERE 1=1`;
  const params = [];

  if (execution_id) {
    query += ` AND execution_id = ?`;
    params.push(execution_id);
  }

  if (test_case_id) {
    query += ` AND test_case_id = ?`;
    params.push(test_case_id);
  }

  if (app_type_id) {
    query += ` AND app_type_id = ?`;
    params.push(app_type_id);
  }

  query += ` ORDER BY created_at DESC`;

  return db.prepare(query).all(...params);
};


// Get Single Result
exports.getExecutionResult = async (id) => {

  const result = await db.prepare(`
    SELECT * FROM execution_results WHERE id = ?
  `).get(id);

  if (!result) throw new Error("Execution result not found");

  return result;
};


// Update Result (only limited fields)
exports.updateExecutionResult = async (id, data) => {

  const existing = await exports.getExecutionResult(id);

  const status = data.status || existing.status;

  if (!VALID_STATUS.includes(status)) {
    throw new Error("Invalid status");
  }

  await db.prepare(`
    UPDATE execution_results
    SET status = ?, duration_ms = ?, error = ?, logs = ?
    WHERE id = ?
  `).run(
    status,
    data.duration_ms ?? existing.duration_ms,
    data.error ?? existing.error,
    data.logs ?? existing.logs,
    id
  );

  return { updated: true };
};


// Delete Result
exports.deleteExecutionResult = async (id) => {

  await exports.getExecutionResult(id);

  await db.prepare(`
    DELETE FROM execution_results WHERE id = ?
  `).run(id);

  return { deleted: true };
};
