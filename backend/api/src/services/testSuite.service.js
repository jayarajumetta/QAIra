const db = require("../db");
const { v4: uuid } = require("uuid");

exports.createTestSuite = ({ app_type_id, name, parent_id }) => {
  if (!app_type_id || !name) {
    throw new Error("Missing required fields");
  }

  const appType = db.prepare(`
    SELECT id FROM app_types WHERE id = ?
  `).get(app_type_id);

  if (!appType) throw new Error("App type not found");

  if (parent_id) {
    const parentSuite = db.prepare(`
      SELECT id, app_type_id FROM test_suites WHERE id = ?
    `).get(parent_id);

    if (!parentSuite) throw new Error("Parent test suite not found");
    if (parentSuite.app_type_id !== app_type_id) {
      throw new Error("Parent suite must belong to the same app type");
    }
  }

  const id = uuid();

  db.prepare(`
    INSERT INTO test_suites (id, app_type_id, name, parent_id)
    VALUES (?, ?, ?, ?)
  `).run(id, app_type_id, name, parent_id || null);

  return { id };
};

exports.getTestSuites = ({ app_type_id, parent_id }) => {
  let query = `SELECT * FROM test_suites WHERE 1=1`;
  const params = [];

  if (app_type_id) {
    query += ` AND app_type_id = ?`;
    params.push(app_type_id);
  }

  if (parent_id !== undefined) {
    if (parent_id === "null") {
      query += ` AND parent_id IS NULL`;
    } else {
      query += ` AND parent_id = ?`;
      params.push(parent_id);
    }
  }

  query += ` ORDER BY created_at DESC`;

  return db.prepare(query).all(...params);
};

exports.getTestSuite = (id) => {
  const suite = db.prepare(`
    SELECT * FROM test_suites WHERE id = ?
  `).get(id);

  if (!suite) throw new Error("Test suite not found");

  return suite;
};

exports.updateTestSuite = (id, data) => {
  const existing = exports.getTestSuite(id);

  let parentId = data.parent_id;

  if (parentId === undefined) {
    parentId = existing.parent_id;
  }

  if (parentId === id) {
    throw new Error("A test suite cannot be its own parent");
  }

  if (parentId) {
    const parentSuite = db.prepare(`
      SELECT id, app_type_id FROM test_suites WHERE id = ?
    `).get(parentId);

    if (!parentSuite) throw new Error("Parent test suite not found");
    if (parentSuite.app_type_id !== existing.app_type_id) {
      throw new Error("Parent suite must belong to the same app type");
    }
  }

  db.prepare(`
    UPDATE test_suites
    SET name = ?, parent_id = ?
    WHERE id = ?
  `).run(
    data.name ?? existing.name,
    parentId || null,
    id
  );

  return { updated: true };
};

exports.deleteTestSuite = (id) => {
  exports.getTestSuite(id);

  const childSuite = db.prepare(`
    SELECT id FROM test_suites WHERE parent_id = ?
  `).get(id);

  if (childSuite) {
    throw new Error("Cannot delete test suite with child suites");
  }

  const testCase = db.prepare(`
    SELECT id FROM test_cases WHERE suite_id = ?
  `).get(id);

  if (testCase) {
    throw new Error("Cannot delete test suite with test cases");
  }

  db.prepare(`
    DELETE FROM test_suites WHERE id = ?
  `).run(id);

  return { deleted: true };
};
