const db = require("../db");
const { v4: uuid } = require("uuid");

exports.createProjectMember = ({ project_id, user_id, role_id }) => {
  if (!project_id || !user_id || !role_id) {
    throw new Error("Missing required fields");
  }

  const project = db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);
  if (!project) throw new Error("Project not found");

  const user = db.prepare(`
    SELECT id FROM users WHERE id = ?
  `).get(user_id);
  if (!user) throw new Error("User not found");

  const role = db.prepare(`
    SELECT id FROM roles WHERE id = ?
  `).get(role_id);
  if (!role) throw new Error("Role not found");

  const existing = db.prepare(`
    SELECT id FROM project_members WHERE project_id = ? AND user_id = ?
  `).get(project_id, user_id);

  if (existing) {
    throw new Error("Project member already exists");
  }

  const id = uuid();

  db.prepare(`
    INSERT INTO project_members (id, project_id, user_id, role_id)
    VALUES (?, ?, ?, ?)
  `).run(id, project_id, user_id, role_id);

  return { id };
};

exports.getProjectMembers = ({ project_id, user_id, role_id }) => {
  let query = `SELECT * FROM project_members WHERE 1=1`;
  const params = [];

  if (project_id) {
    query += ` AND project_id = ?`;
    params.push(project_id);
  }

  if (user_id) {
    query += ` AND user_id = ?`;
    params.push(user_id);
  }

  if (role_id) {
    query += ` AND role_id = ?`;
    params.push(role_id);
  }

  query += ` ORDER BY created_at DESC`;

  return db.prepare(query).all(...params);
};

exports.getProjectMember = (id) => {
  const member = db.prepare(`
    SELECT * FROM project_members WHERE id = ?
  `).get(id);

  if (!member) throw new Error("Project member not found");

  return member;
};

exports.updateProjectMember = (id, data) => {
  const existing = exports.getProjectMember(id);

  if (data.project_id) {
    const project = db.prepare(`
      SELECT id FROM projects WHERE id = ?
    `).get(data.project_id);
    if (!project) throw new Error("Project not found");
  }

  if (data.user_id) {
    const user = db.prepare(`
      SELECT id FROM users WHERE id = ?
    `).get(data.user_id);
    if (!user) throw new Error("User not found");
  }

  if (data.role_id) {
    const role = db.prepare(`
      SELECT id FROM roles WHERE id = ?
    `).get(data.role_id);
    if (!role) throw new Error("Role not found");
  }

  const nextProjectId = data.project_id ?? existing.project_id;
  const nextUserId = data.user_id ?? existing.user_id;
  const duplicate = db.prepare(`
    SELECT id FROM project_members
    WHERE project_id = ? AND user_id = ? AND id != ?
  `).get(nextProjectId, nextUserId, id);

  if (duplicate) {
    throw new Error("Project member already exists");
  }

  db.prepare(`
    UPDATE project_members
    SET project_id = ?, user_id = ?, role_id = ?
    WHERE id = ?
  `).run(
    nextProjectId,
    nextUserId,
    data.role_id ?? existing.role_id,
    id
  );

  return { updated: true };
};

exports.deleteProjectMember = (id) => {
  exports.getProjectMember(id);

  db.prepare(`
    DELETE FROM project_members WHERE id = ?
  `).run(id);

  return { deleted: true };
};
