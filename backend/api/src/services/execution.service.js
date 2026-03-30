const db = require("../db");
const { v4: uuid } = require("uuid");

const getSuiteIdsForExecution = db.prepare(`
  SELECT suite_id, suite_name
  FROM execution_suites
  WHERE execution_id = ?
  ORDER BY suite_id ASC
`);

const insertExecutionSuite = db.prepare(`
  INSERT INTO execution_suites (execution_id, suite_id, suite_name)
  VALUES (?, ?, ?)
`);

async function attachScope(execution) {
  if (!execution) {
    return execution;
  }

  const suiteRows = await getSuiteIdsForExecution.all(execution.id);
  const suite_ids = suiteRows.map((row) => row.suite_id);

  return {
    ...execution,
    suite_ids,
    suite_snapshots: suiteRows.map((row) => ({ id: row.suite_id, name: row.suite_name || "Deleted Suite" }))
  };
}

exports.createExecution = async ({ project_id, app_type_id, suite_ids = [], name, created_by }) => {
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

  const uniqueSuiteIds = [...new Set(suite_ids)];

  if (uniqueSuiteIds.length && !app_type_id) {
    throw new Error("app_type_id is required when suite_ids are provided");
  }

  const validateSuite = db.prepare(`
    SELECT id, app_type_id, name
    FROM test_suites
    WHERE id = ?
  `);

  for (const suiteId of uniqueSuiteIds) {
    const suite = await validateSuite.get(suiteId);

    if (!suite) {
      throw new Error(`Suite not found: ${suiteId}`);
    }

    if (suite.app_type_id !== app_type_id) {
      throw new Error("All suites must belong to the selected app type");
    }
  }

  const id = uuid();

  const transaction = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO executions
      (id, project_id, app_type_id, name, trigger, status, created_by)
      VALUES (?, ?, ?, ?, 'manual', 'queued', ?)
    `).run(id, project_id, app_type_id || null, name || "Execution Run", created_by);

    for (const suiteId of uniqueSuiteIds) {
      const suite = await validateSuite.get(suiteId);
      await insertExecutionSuite.run(id, suiteId, suite?.name || null);
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

  return attachScope(execution);
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

  await db.prepare(`DELETE FROM execution_suites WHERE execution_id = ?`).run(id);
  await db.prepare(`DELETE FROM executions WHERE id = ?`).run(id);

  return { deleted: true };
};
