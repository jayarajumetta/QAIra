const db = require("../db");
const { v4: uuid } = require("uuid");
const requirementTestCaseService = require("./requirementTestCase.service");
const suiteTestCaseService = require("./suiteTestCase.service");

const hydrateSuiteIds = (testCase) => {
  if (!testCase) {
    return testCase;
  }

  return {
    ...testCase,
    suite_ids: suiteTestCaseService.getSuiteIdsForTestCase(testCase.id),
    requirement_ids: requirementTestCaseService.getRequirementIdsForTestCase(testCase.id)
  };
};

exports.createTestCase = ({ suite_id, suite_ids = [], title, description, priority, status, requirement_id, requirement_ids = [] }) => {
  if (!title) {
    throw new Error("Missing required fields");
  }

  const requestedSuiteIds = [...new Set([suite_id, ...suite_ids].filter(Boolean))];
  const requestedRequirementIds = [...new Set([requirement_id, ...requirement_ids].filter(Boolean))];

  requestedRequirementIds.forEach((requestedRequirementId) => {
    const requirement = db.prepare(`
      SELECT id FROM requirements WHERE id = ?
    `).get(requestedRequirementId);

    if (!requirement) throw new Error("Requirement not found");
  });

  const id = uuid();

  db.prepare(`
    INSERT INTO test_cases (id, suite_id, title, description, priority, status, requirement_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    requestedSuiteIds[0] || null,
    title,
    description || null,
    priority ?? 3,
    status || "active",
    requestedRequirementIds[0] || null
  );

  if (requestedSuiteIds.length) {
    suiteTestCaseService.syncMappingsForTestCase(id, requestedSuiteIds);
  }

  if (requestedRequirementIds.length) {
    requirementTestCaseService.syncMappingsForTestCase(id, requestedRequirementIds);
  }

  return { id };
};

exports.getTestCases = ({ suite_id, requirement_id, status, app_type_id }) => {
  let query = `SELECT DISTINCT test_cases.* FROM test_cases`;
  const joins = [];
  const where = [`1=1`];
  const params = [];

  if (suite_id || app_type_id) {
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
    where.push(`test_suites.app_type_id = ?`);
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

  return db.prepare(query).all(...params).map(hydrateSuiteIds);
};

exports.getTestCase = (id) => {
  const testCase = db.prepare(`
    SELECT *
    FROM test_cases
    WHERE id = ?
  `).get(id);

  if (!testCase) throw new Error("Test case not found");

  return hydrateSuiteIds(testCase);
};

exports.updateTestCase = (id, data) => {
  const existing = exports.getTestCase(id);

  const requestedSuiteIds = data.suite_ids !== undefined
    ? [...new Set(data.suite_ids.filter(Boolean))]
    : data.suite_id
      ? [...new Set([data.suite_id, ...existing.suite_ids])]
      : existing.suite_ids;
  const requestedRequirementIds = data.requirement_ids !== undefined
    ? [...new Set(data.requirement_ids.filter(Boolean))]
    : data.requirement_id !== undefined
      ? [...new Set([data.requirement_id].filter(Boolean))]
      : existing.requirement_ids;

  requestedRequirementIds.forEach((requestedRequirementId) => {
    const requirement = db.prepare(`
      SELECT id FROM requirements WHERE id = ?
    `).get(requestedRequirementId);

    if (!requirement) throw new Error("Requirement not found");
  });

  db.prepare(`
    UPDATE test_cases
    SET suite_id = ?, title = ?, description = ?, priority = ?, status = ?, requirement_id = ?
    WHERE id = ?
  `).run(
    requestedSuiteIds[0] || null,
    data.title ?? existing.title,
    data.description ?? existing.description,
    data.priority ?? existing.priority,
    data.status ?? existing.status,
    requestedRequirementIds[0] || null,
    id
  );

  if (data.suite_ids !== undefined || data.suite_id !== undefined) {
    suiteTestCaseService.syncMappingsForTestCase(id, requestedSuiteIds);
  }

  if (data.requirement_ids !== undefined || data.requirement_id !== undefined) {
    requirementTestCaseService.syncMappingsForTestCase(id, requestedRequirementIds);
  }

  return { updated: true };
};

exports.deleteTestCase = (id) => {
  exports.getTestCase(id);

  db.prepare(`
    DELETE FROM test_steps
    WHERE test_case_id = ?
  `).run(id);

  db.prepare(`
    DELETE FROM requirement_test_cases
    WHERE test_case_id = ?
  `).run(id);

  db.prepare(`
    DELETE FROM suite_test_cases
    WHERE test_case_id = ?
  `).run(id);

  db.prepare(`
    DELETE FROM test_cases WHERE id = ?
  `).run(id);

  return { deleted: true };
};
