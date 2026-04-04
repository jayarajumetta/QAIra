const db = require("../db");
const { v4: uuid } = require("uuid");

const selectRoleByName = db.prepare(`
  SELECT id
  FROM roles
  WHERE name = ?
`);

const selectAdminUsers = db.prepare(`
  SELECT DISTINCT users.id
  FROM users
  JOIN project_members ON project_members.user_id = users.id
  JOIN roles ON roles.id = project_members.role_id
  WHERE roles.name = 'admin'
`);

const insertProjectMember = db.prepare(`
  INSERT INTO project_members (id, project_id, user_id, role_id)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (project_id, user_id) DO NOTHING
`);

exports.createProject = async ({ name, description, created_by }) => {
  if (!name || !created_by) throw new Error("Missing fields");

  const id = uuid();

  const user = await db.prepare("SELECT id FROM users WHERE id = ?").get(created_by);
  if (!user) throw new Error("Invalid user");

  const adminRole = await selectRoleByName.get("admin");
  const memberRole = await selectRoleByName.get("member");
  const fallbackRoleId = adminRole?.id || memberRole?.id;

  if (!fallbackRoleId) {
    throw new Error("No project roles are configured");
  }

  const adminUsers = await selectAdminUsers.all();
  const memberships = new Map();

  for (const adminUser of adminUsers) {
    memberships.set(adminUser.id, adminRole?.id || fallbackRoleId);
  }

  memberships.set(created_by, adminRole?.id || fallbackRoleId);

  const createProjectWithMemberships = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO projects (id, name, description, created_by)
      VALUES (?, ?, ?, ?)
    `).run(id, name, description, created_by);

    for (const [userId, roleId] of memberships.entries()) {
      await insertProjectMember.run(uuid(), id, userId, roleId);
    }
  });

  await createProjectWithMemberships();

  return { id };
};

// Get projects filtered by user membership
exports.getProjects = async (userId = null) => {
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

exports.getProject = async (id, userId = null) => {
  const project = await db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!project) throw new Error("Project not found");
  
  // If userId provided, verify user is a member
  if (userId) {
    const membership = await db.prepare(`
      SELECT id FROM project_members 
      WHERE project_id = ? AND user_id = ?
    `).get(id, userId);
    
    if (!membership) {
      throw new Error("Access denied: You are not a member of this project");
    }
  }
  
  return project;
};

exports.updateProject = async (id, data) => {
  const existing = await exports.getProject(id);

  await db.prepare(`
    UPDATE projects SET name = ?, description = ?
    WHERE id = ?
  `).run(data.name || existing.name, data.description || existing.description, id);

  return { updated: true };
};

exports.deleteProject = async (id) => {
  await exports.getProject(id);

  const dependencies = [
    { table: "project_members", field: "project_id", message: "Cannot delete project with members" },
    { table: "app_types", field: "project_id", message: "Cannot delete project with app types" },
    { table: "requirements", field: "project_id", message: "Cannot delete project with requirements" },
    { table: "executions", field: "project_id", message: "Cannot delete project with executions" }
  ];

  for (const dependency of dependencies) {
    const used = await db.prepare(`
      SELECT id FROM ${dependency.table} WHERE ${dependency.field} = ?
    `).get(id);

    if (used) {
      throw new Error(dependency.message);
    }
  }

  await db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return { deleted: true };
};
