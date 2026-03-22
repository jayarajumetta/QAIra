const db = require("../db");
const { v4: uuid } = require("uuid");

exports.createProject = ({ name, description, created_by }) => {
  if (!name || !created_by) throw new Error("Missing fields");

  const id = uuid();

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(created_by);
  if (!user) throw new Error("Invalid user");

  db.prepare(`
    INSERT INTO projects (id, name, description, created_by)
    VALUES (?, ?, ?, ?)
  `).run(id, name, description, created_by);

  return { id };
};

// Get projects filtered by user membership
exports.getProjects = (userId = null) => {
  if (!userId) {
    return db.prepare("SELECT * FROM projects").all();
  }
  
  // Only return projects where user is a member
  return db.prepare(`
    SELECT DISTINCT p.* 
    FROM projects p
    INNER JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId);
};

exports.getProject = (id, userId = null) => {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!project) throw new Error("Project not found");
  
  // If userId provided, verify user is a member
  if (userId) {
    const membership = db.prepare(`
      SELECT id FROM project_members 
      WHERE project_id = ? AND user_id = ?
    `).get(id, userId);
    
    if (!membership) {
      throw new Error("Access denied: You are not a member of this project");
    }
  }
  
  return project;
};

exports.updateProject = (id, data) => {
  const existing = exports.getProject(id);

  db.prepare(`
    UPDATE projects SET name = ?, description = ?
    WHERE id = ?
  `).run(data.name || existing.name, data.description || existing.description, id);

  return { updated: true };
};

exports.deleteProject = (id) => {
  exports.getProject(id);

  const dependencies = [
    { table: "project_members", field: "project_id", message: "Cannot delete project with members" },
    { table: "app_types", field: "project_id", message: "Cannot delete project with app types" },
    { table: "requirements", field: "project_id", message: "Cannot delete project with requirements" },
    { table: "executions", field: "project_id", message: "Cannot delete project with executions" }
  ];

  for (const dependency of dependencies) {
    const used = db.prepare(`
      SELECT id FROM ${dependency.table} WHERE ${dependency.field} = ?
    `).get(id);

    if (used) {
      throw new Error(dependency.message);
    }
  }

  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return { deleted: true };
};
