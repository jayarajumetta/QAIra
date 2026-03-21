const db = require("../db");

const listForRequirement = db.prepare(`
  SELECT test_case_id
  FROM requirement_test_cases
  WHERE requirement_id = ?
  ORDER BY test_case_id ASC
`);

const listForTestCase = db.prepare(`
  SELECT requirement_id
  FROM requirement_test_cases
  WHERE test_case_id = ?
  ORDER BY requirement_id ASC
`);

const deleteForRequirement = db.prepare(`
  DELETE FROM requirement_test_cases
  WHERE requirement_id = ?
`);

const deleteForTestCase = db.prepare(`
  DELETE FROM requirement_test_cases
  WHERE test_case_id = ?
`);

const insertMapping = db.prepare(`
  INSERT OR IGNORE INTO requirement_test_cases (requirement_id, test_case_id)
  VALUES (?, ?)
`);

exports.getTestCaseIdsForRequirement = (requirementId) => {
  return listForRequirement.all(requirementId).map((row) => row.test_case_id);
};

exports.getRequirementIdsForTestCase = (testCaseId) => {
  return listForTestCase.all(testCaseId).map((row) => row.requirement_id);
};

exports.listMappings = ({ requirement_id, test_case_id }) => {
  let query = `
    SELECT requirement_id, test_case_id
    FROM requirement_test_cases
    WHERE 1 = 1
  `;
  const params = [];

  if (requirement_id) {
    query += ` AND requirement_id = ?`;
    params.push(requirement_id);
  }

  if (test_case_id) {
    query += ` AND test_case_id = ?`;
    params.push(test_case_id);
  }

  query += ` ORDER BY requirement_id ASC, test_case_id ASC`;

  return db.prepare(query).all(...params);
};

exports.replaceMappingsForRequirement = (requirementId, testCaseIds = []) => {
  const requirement = db.prepare(`
    SELECT id
    FROM requirements
    WHERE id = ?
  `).get(requirementId);

  if (!requirement) {
    throw new Error("Requirement not found");
  }

  const uniqueIds = [...new Set(testCaseIds.filter(Boolean))];
  const selectTestCase = db.prepare(`
    SELECT id
    FROM test_cases
    WHERE id = ?
  `);
  const syncLegacyRequirement = db.prepare(`
    UPDATE test_cases
    SET requirement_id = ?
    WHERE id = ?
  `);

  uniqueIds.forEach((testCaseId) => {
    const testCase = selectTestCase.get(testCaseId);

    if (!testCase) {
      throw new Error(`Test case not found: ${testCaseId}`);
    }
  });

  const transaction = db.transaction(() => {
    deleteForRequirement.run(requirementId);
    db.prepare(`
      UPDATE test_cases
      SET requirement_id = NULL
      WHERE requirement_id = ?
    `).run(requirementId);

    uniqueIds.forEach((testCaseId) => {
      insertMapping.run(requirementId, testCaseId);
      syncLegacyRequirement.run(requirementId, testCaseId);
    });
  });

  transaction();

  return { updated: true, mapped: uniqueIds.length };
};

exports.syncMappingsForTestCase = (testCaseId, requirementIds = []) => {
  const uniqueIds = [...new Set(requirementIds.filter(Boolean))];
  const selectRequirement = db.prepare(`
    SELECT id
    FROM requirements
    WHERE id = ?
  `);

  uniqueIds.forEach((requirementId) => {
    const requirement = selectRequirement.get(requirementId);

    if (!requirement) {
      throw new Error(`Requirement not found: ${requirementId}`);
    }
  });

  const updateLegacyRequirement = db.prepare(`
    UPDATE test_cases
    SET requirement_id = ?
    WHERE id = ?
  `);

  const transaction = db.transaction(() => {
    deleteForTestCase.run(testCaseId);
    uniqueIds.forEach((requirementId) => insertMapping.run(requirementId, testCaseId));
    updateLegacyRequirement.run(uniqueIds[0] || null, testCaseId);
  });

  transaction();
};
