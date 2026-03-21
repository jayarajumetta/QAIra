const db = require("../db");
const { v4: uuid } = require("uuid");

const VALID_STATUS = ["passed", "failed", "blocked"];

// Create Result
exports.createExecutionResult = (data) => {

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
  const execution = db.prepare(`
    SELECT id FROM executions WHERE id = ?
  `).get(execution_id);

  if (!execution) throw new Error("Execution not found");

  // Validate test case
  const testCase = db.prepare(`
    SELECT id FROM test_cases WHERE id = ?
  `).get(test_case_id);

  if (!testCase) throw new Error("Test case not found");

  // Validate app type
  const appType = db.prepare(`
    SELECT id FROM app_types WHERE id = ?
  `).get(app_type_id);

  if (!appType) throw new Error("App type not found");

  // Optional: Validate user
  if (executed_by) {
    const user = db.prepare(`
      SELECT id FROM users WHERE id = ?
    `).get(executed_by);

    if (!user) throw new Error("Invalid user");
  }

  const id = uuid();

  db.prepare(`
    INSERT INTO execution_results
    (id, execution_id, test_case_id, app_type_id, status, duration_ms, error, logs, executed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    execution_id,
    test_case_id,
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
exports.getExecutionResults = ({ execution_id, test_case_id, app_type_id }) => {

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
exports.getExecutionResult = (id) => {

  const result = db.prepare(`
    SELECT * FROM execution_results WHERE id = ?
  `).get(id);

  if (!result) throw new Error("Execution result not found");

  return result;
};


// Update Result (only limited fields)
exports.updateExecutionResult = (id, data) => {

  const existing = exports.getExecutionResult(id);

  const status = data.status || existing.status;

  if (!VALID_STATUS.includes(status)) {
    throw new Error("Invalid status");
  }

  db.prepare(`
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
exports.deleteExecutionResult = (id) => {

  const existing = exports.getExecutionResult(id);

  db.prepare(`
    DELETE FROM execution_results WHERE id = ?
  `).run(id);

  return { deleted: true };
};