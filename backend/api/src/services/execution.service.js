const db = require("../db");
const { v4: uuid } = require("uuid");

// Create Execution
exports.createExecution = ({ project_id, name, created_by }) => {

  if (!project_id || !created_by) {
    throw new Error("Missing required fields");
  }

  // Validate project
  const project = db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);

  if (!project) throw new Error("Project not found");

  // Validate user
  const user = db.prepare(`
    SELECT id FROM users WHERE id = ?
  `).get(created_by);

  if (!user) throw new Error("Invalid user");

  const id = uuid();

  db.prepare(`
    INSERT INTO executions 
    (id, project_id, name, trigger, status, created_by)
    VALUES (?, ?, ?, 'manual', 'queued', ?)
  `).run(id, project_id, name || "Execution Run", created_by);

  return { id };
};


// Get all executions (with optional filters)
exports.getExecutions = ({ project_id, status }) => {

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

  return db.prepare(query).all(...params);
};


// Get single execution
exports.getExecution = (id) => {

  const execution = db.prepare(`
    SELECT * FROM executions WHERE id = ?
  `).get(id);

  if (!execution) throw new Error("Execution not found");

  return execution;
};


// Start Execution
exports.startExecution = (id) => {

  const execution = exports.getExecution(id);

  if (execution.status !== "queued") {
    throw new Error("Only queued executions can be started");
  }

  db.prepare(`
    UPDATE executions
    SET status = 'running', started_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);

  return { started: true };
};


// Complete Execution
exports.completeExecution = (id, status) => {

  if (!["completed", "failed"].includes(status)) {
    throw new Error("Invalid completion status");
  }

  const execution = exports.getExecution(id);

  if (execution.status !== "running") {
    throw new Error("Only running executions can be completed");
  }

  db.prepare(`
    UPDATE executions
    SET status = ?, ended_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, id);

  return { completed: true };
};


// Delete Execution
exports.deleteExecution = (id) => {

  const execution = exports.getExecution(id);

  // Check dependent execution_results
  const used = db.prepare(`
    SELECT id FROM execution_results WHERE execution_id = ?
  `).get(id);

  if (used) {
    throw new Error("Cannot delete execution with results");
  }

  db.prepare(`DELETE FROM executions WHERE id = ?`)
    .run(id);

  return { deleted: true };
};
