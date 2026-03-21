const db = require("../db");
const { v4: uuid } = require("uuid");

exports.createTestCase = ({ suite_id, title, description, priority, status, requirement_id }) => {
  if (!suite_id || !title) {
    throw new Error("Missing required fields");
  }

  const suite = db.prepare(`
    SELECT id FROM test_suites WHERE id = ?
  `).get(suite_id);

  if (!suite) throw new Error("Test suite not found");

  if (requirement_id) {
    const requirement = db.prepare(`
      SELECT id FROM requirements WHERE id = ?
    `).get(requirement_id);

    if (!requirement) throw new Error("Requirement not found");
  }

  const id = uuid();

  db.prepare(`
    INSERT INTO test_cases (id, suite_id, title, description, priority, status, requirement_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    suite_id,
    title,
    description || null,
    priority ?? 3,
    status || "active",
    requirement_id || null
  );

  return { id };
};

exports.getTestCases = ({ suite_id, requirement_id, status }) => {
  let query = `SELECT * FROM test_cases WHERE 1=1`;
  const params = [];

  if (suite_id) {
    query += ` AND suite_id = ?`;
    params.push(suite_id);
  }

  if (requirement_id) {
    query += ` AND requirement_id = ?`;
    params.push(requirement_id);
  }

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  query += ` ORDER BY created_at DESC`;

  return db.prepare(query).all(...params);
};

exports.getTestCase = (id) => {
  const testCase = db.prepare(`
    SELECT * FROM test_cases WHERE id = ?
  `).get(id);

  if (!testCase) throw new Error("Test case not found");

  return testCase;
};

exports.updateTestCase = (id, data) => {
  const existing = exports.getTestCase(id);

  if (data.suite_id) {
    const suite = db.prepare(`
      SELECT id FROM test_suites WHERE id = ?
    `).get(data.suite_id);

    if (!suite) throw new Error("Test suite not found");
  }

  if (data.requirement_id) {
    const requirement = db.prepare(`
      SELECT id FROM requirements WHERE id = ?
    `).get(data.requirement_id);

    if (!requirement) throw new Error("Requirement not found");
  }

  db.prepare(`
    UPDATE test_cases
    SET suite_id = ?, title = ?, description = ?, priority = ?, status = ?, requirement_id = ?
    WHERE id = ?
  `).run(
    data.suite_id ?? existing.suite_id,
    data.title ?? existing.title,
    data.description ?? existing.description,
    data.priority ?? existing.priority,
    data.status ?? existing.status,
    data.requirement_id ?? existing.requirement_id,
    id
  );

  return { updated: true };
};

exports.deleteTestCase = (id) => {
  exports.getTestCase(id);

  const step = db.prepare(`
    SELECT id FROM test_steps WHERE test_case_id = ?
  `).get(id);

  if (step) {
    throw new Error("Cannot delete test case with test steps");
  }

  const result = db.prepare(`
    SELECT id FROM execution_results WHERE test_case_id = ?
  `).get(id);

  if (result) {
    throw new Error("Cannot delete test case with execution results");
  }

  db.prepare(`
    DELETE FROM test_cases WHERE id = ?
  `).run(id);

  return { deleted: true };
};
