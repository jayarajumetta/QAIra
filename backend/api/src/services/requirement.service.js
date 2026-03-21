const db = require("../db");
const { v4: uuid } = require("uuid");
const requirementTestCaseService = require("./requirementTestCase.service");

const hydrateTestCaseIds = (requirement) => {
  if (!requirement) {
    return requirement;
  }

  return {
    ...requirement,
    test_case_ids: requirementTestCaseService.getTestCaseIdsForRequirement(requirement.id)
  };
};

exports.createRequirement = ({ project_id, title, description, priority, status }) => {
  if (!project_id || !title) {
    throw new Error("Missing required fields");
  }

  const project = db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);

  if (!project) throw new Error("Project not found");

  const id = uuid();

  db.prepare(`
    INSERT INTO requirements (id, project_id, title, description, priority, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    project_id,
    title,
    description || null,
    priority ?? 3,
    status || null
  );

  return { id };
};

exports.getRequirements = ({ project_id, status, priority }) => {
  let query = `SELECT * FROM requirements WHERE 1=1`;
  const params = [];

  if (project_id) {
    query += ` AND project_id = ?`;
    params.push(project_id);
  }

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  if (priority !== undefined) {
    query += ` AND priority = ?`;
    params.push(priority);
  }

  query += ` ORDER BY created_at DESC`;

  return db.prepare(query).all(...params).map(hydrateTestCaseIds);
};

exports.getRequirement = (id) => {
  const requirement = db.prepare(`
    SELECT * FROM requirements WHERE id = ?
  `).get(id);

  if (!requirement) throw new Error("Requirement not found");

  return hydrateTestCaseIds(requirement);
};

exports.updateRequirement = (id, data) => {
  const existing = exports.getRequirement(id);

  if (data.project_id) {
    const project = db.prepare(`
      SELECT id FROM projects WHERE id = ?
    `).get(data.project_id);

    if (!project) throw new Error("Project not found");
  }

  db.prepare(`
    UPDATE requirements
    SET project_id = ?, title = ?, description = ?, priority = ?, status = ?
    WHERE id = ?
  `).run(
    data.project_id ?? existing.project_id,
    data.title ?? existing.title,
    data.description ?? existing.description,
    data.priority ?? existing.priority,
    data.status ?? existing.status,
    id
  );

  return { updated: true };
};

exports.deleteRequirement = (id) => {
  exports.getRequirement(id);
  db.prepare(`
    DELETE FROM requirement_test_cases
    WHERE requirement_id = ?
  `).run(id);

  db.prepare(`
    UPDATE test_cases
    SET requirement_id = NULL
    WHERE requirement_id = ?
  `).run(id);

  db.prepare(`
    DELETE FROM requirements WHERE id = ?
  `).run(id);

  return { deleted: true };
};
