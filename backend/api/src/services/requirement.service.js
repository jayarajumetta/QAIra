const db = require("../db");
const { v4: uuid } = require("uuid");
const requirementTestCaseService = require("./requirementTestCase.service");
const displayIdService = require("./displayId.service");

const hydrateTestCaseIds = async (requirement) => {
  if (!requirement) {
    return requirement;
  }

  return {
    ...requirement,
    test_case_ids: await requirementTestCaseService.getTestCaseIdsForRequirement(requirement.id)
  };
};

exports.bulkImportRequirements = async ({ project_id, rows = [] }) => {
  if (!project_id) {
    throw new Error("project_id is required");
  }

  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("At least one row is required");
  }

  const project = await db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);

  if (!project) {
    throw new Error("Project not found");
  }

  const created = [];
  const errors = [];

  for (const [index, row] of rows.entries()) {
    const title = typeof row?.title === "string" ? row.title.trim() : "";

    try {
      if (title.length < 2) {
        throw new Error("Title must be at least 2 characters");
      }

      const response = await exports.createRequirement({
        project_id,
        title,
        description: typeof row?.description === "string" ? row.description : undefined,
        priority: typeof row?.priority === "number" && Number.isFinite(row.priority) ? row.priority : undefined,
        status: typeof row?.status === "string" ? row.status : undefined
      });

      created.push({
        row: index + 1,
        id: response.id,
        title
      });
    } catch (error) {
      errors.push({
        row: index + 1,
        title: title || null,
        message: error.message || "Unable to import requirement"
      });
    }
  }

  return {
    imported: created.length,
    failed: errors.length,
    created,
    errors
  };
};

exports.createRequirement = async ({ project_id, title, description, priority, status }) => {
  if (!project_id || !title) {
    throw new Error("Missing required fields");
  }

  const project = await db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);

  if (!project) throw new Error("Project not found");

  const id = uuid();
  const display_id = await displayIdService.createDisplayId("requirement");

  await db.prepare(`
    INSERT INTO requirements (id, display_id, project_id, title, description, priority, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    display_id,
    project_id,
    title,
    description || null,
    priority ?? 3,
    status || null
  );

  return { id };
};

exports.getRequirements = async ({ project_id, status, priority }) => {
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

  const rows = await db.prepare(query).all(...params);
  return Promise.all(rows.map(hydrateTestCaseIds));
};

exports.getRequirement = async (id) => {
  const requirement = await db.prepare(`
    SELECT * FROM requirements WHERE id = ?
  `).get(id);

  if (!requirement) throw new Error("Requirement not found");

  return hydrateTestCaseIds(requirement);
};

exports.updateRequirement = async (id, data) => {
  const existing = await exports.getRequirement(id);

  if (data.project_id) {
    const project = await db.prepare(`
      SELECT id FROM projects WHERE id = ?
    `).get(data.project_id);

    if (!project) throw new Error("Project not found");
  }

  await db.prepare(`
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

exports.deleteRequirement = async (id) => {
  await exports.getRequirement(id);
  await db.prepare(`
    DELETE FROM requirement_test_cases
    WHERE requirement_id = ?
  `).run(id);

  await db.prepare(`
    UPDATE test_cases
    SET requirement_id = NULL
    WHERE requirement_id = ?
  `).run(id);

  await db.prepare(`
    DELETE FROM requirements WHERE id = ?
  `).run(id);

  return { deleted: true };
};
