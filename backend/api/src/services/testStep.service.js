const db = require("../db");
const { v4: uuid } = require("uuid");

exports.createTestStep = ({ test_case_id, step_order, action, expected_result }) => {
  if (!test_case_id || step_order === undefined) {
    throw new Error("Missing required fields");
  }

  const testCase = db.prepare(`
    SELECT id FROM test_cases WHERE id = ?
  `).get(test_case_id);

  if (!testCase) throw new Error("Test case not found");

  const id = uuid();

  db.prepare(`
    INSERT INTO test_steps (id, test_case_id, step_order, action, expected_result)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, test_case_id, step_order, action || null, expected_result || null);

  return { id };
};

exports.getTestSteps = ({ test_case_id }) => {
  let query = `SELECT * FROM test_steps WHERE 1=1`;
  const params = [];

  if (test_case_id) {
    query += ` AND test_case_id = ?`;
    params.push(test_case_id);
  }

  query += ` ORDER BY test_case_id ASC, step_order ASC`;

  return db.prepare(query).all(...params);
};

exports.getTestStep = (id) => {
  const step = db.prepare(`
    SELECT * FROM test_steps WHERE id = ?
  `).get(id);

  if (!step) throw new Error("Test step not found");

  return step;
};

exports.updateTestStep = (id, data) => {
  const existing = exports.getTestStep(id);

  if (data.test_case_id) {
    const testCase = db.prepare(`
      SELECT id FROM test_cases WHERE id = ?
    `).get(data.test_case_id);

    if (!testCase) throw new Error("Test case not found");
  }

  db.prepare(`
    UPDATE test_steps
    SET test_case_id = ?, step_order = ?, action = ?, expected_result = ?
    WHERE id = ?
  `).run(
    data.test_case_id ?? existing.test_case_id,
    data.step_order ?? existing.step_order,
    data.action ?? existing.action,
    data.expected_result ?? existing.expected_result,
    id
  );

  return { updated: true };
};

exports.deleteTestStep = (id) => {
  exports.getTestStep(id);

  db.prepare(`
    DELETE FROM test_steps WHERE id = ?
  `).run(id);

  return { deleted: true };
};
