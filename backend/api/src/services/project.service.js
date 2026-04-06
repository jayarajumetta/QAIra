const db = require("../db");
const { v4: uuid } = require("uuid");
const VALID_APP_TYPES = new Set(["web", "api", "android", "ios", "unified"]);

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

const insertAppType = db.prepare(`
  INSERT INTO app_types (id, project_id, name, type, is_unified)
  VALUES (?, ?, ?, ?, ?)
`);

const selectUserById = db.prepare(`
  SELECT id
  FROM users
  WHERE id = ?
`);

exports.createProject = async ({ name, description, created_by, member_ids, app_types }) => {
  if (!name || !created_by) throw new Error("Missing fields");

  const normalizedName = String(name).trim();
  if (!normalizedName) throw new Error("Project name is required");

  const id = uuid();

  const user = await selectUserById.get(created_by);
  if (!user) throw new Error("Invalid user");

  const normalizedMemberIds = Array.isArray(member_ids)
    ? [...new Set(member_ids.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
  const normalizedAppTypes = Array.isArray(app_types)
    ? app_types
        .map((item = {}) => ({
          name: String(item.name || "").trim(),
          type: String(item.type || "").trim(),
          is_unified: Boolean(item.is_unified)
        }))
        .filter((item) => item.name || item.type)
    : [];

  const adminRole = await selectRoleByName.get("admin");
  const memberRole = await selectRoleByName.get("member");
  const creatorRoleId = memberRole?.id || adminRole?.id;
  const selectedMemberRoleId = memberRole?.id || adminRole?.id;

  if (!creatorRoleId || !selectedMemberRoleId) {
    throw new Error("No project roles are configured");
  }

  const seenAppTypes = new Set();
  normalizedAppTypes.forEach((appType, index) => {
    if (!appType.name) {
      throw new Error(`App type ${index + 1} is missing a name`);
    }

    if (!VALID_APP_TYPES.has(appType.type)) {
      throw new Error(`App type ${index + 1} has an invalid type`);
    }

    if (seenAppTypes.has(appType.type)) {
      throw new Error(`App type '${appType.type}' can only be added once per project`);
    }

    seenAppTypes.add(appType.type);
  });

  for (const memberId of normalizedMemberIds) {
    const memberUser = await selectUserById.get(memberId);

    if (!memberUser) {
      throw new Error("One of the selected members no longer exists");
    }
  }

  const adminUsers = await selectAdminUsers.all();
  const memberships = new Map();

  for (const adminUser of adminUsers) {
    memberships.set(adminUser.id, adminRole?.id || creatorRoleId);
  }

  memberships.set(created_by, creatorRoleId);

  for (const memberId of normalizedMemberIds) {
    if (!memberships.has(memberId)) {
      memberships.set(memberId, selectedMemberRoleId);
    }
  }

  const createProjectWithMemberships = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO projects (id, name, description, created_by)
      VALUES (?, ?, ?, ?)
    `).run(id, normalizedName, description || null, created_by);

    for (const [userId, roleId] of memberships.entries()) {
      await insertProjectMember.run(uuid(), id, userId, roleId);
    }

    for (const appType of normalizedAppTypes) {
      await insertAppType.run(uuid(), id, appType.name, appType.type, Boolean(appType.is_unified));
    }
  });

  await createProjectWithMemberships();

  return {
    id,
    members_added: memberships.size,
    app_types_created: normalizedAppTypes.length
  };
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
