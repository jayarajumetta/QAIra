const db = require("../db");
const { v4: uuid } = require("uuid");

exports.createUser = ({ email, password_hash, name, role_id }) => {
  if (!email || !password_hash || !role_id) {
    throw new Error("Missing required fields");
  }

  const existing = db.prepare(`
    SELECT id FROM users WHERE email = ?
  `).get(email);

  if (existing) throw new Error("User already exists");

  const role = db.prepare(`
    SELECT id FROM roles WHERE id = ?
  `).get(role_id);

  if (!role) throw new Error("Role not found");

  const id = uuid();

  const createUserStatement = db.prepare(`
    INSERT INTO users (id, email, password_hash, name)
    VALUES (?, ?, ?, ?)
  `);
  const projects = db.prepare(`SELECT id FROM projects`).all();
  const createMembership = db.prepare(`
    INSERT INTO project_members (id, project_id, user_id, role_id)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    createUserStatement.run(id, email, password_hash, name || null);

    projects.forEach((project) => {
      createMembership.run(uuid(), project.id, id, role_id);
    });
  });

  transaction();

  return { id };
};

exports.getUsers = () => {
  return db.prepare(`
    SELECT users.id, users.email, users.name, users.created_at,
      (
        SELECT roles.name
        FROM project_members
        JOIN roles ON roles.id = project_members.role_id
        WHERE project_members.user_id = users.id
        ORDER BY CASE roles.name WHEN 'admin' THEN 0 ELSE 1 END
        LIMIT 1
      ) AS role
    FROM users
    ORDER BY created_at DESC
  `).all();
};

exports.getUser = (id) => {
  const user = db.prepare(`
    SELECT users.id, users.email, users.name, users.created_at,
      (
        SELECT roles.name
        FROM project_members
        JOIN roles ON roles.id = project_members.role_id
        WHERE project_members.user_id = users.id
        ORDER BY CASE roles.name WHEN 'admin' THEN 0 ELSE 1 END
        LIMIT 1
      ) AS role
    FROM users
    WHERE users.id = ?
  `).get(id);

  if (!user) throw new Error("User not found");

  return user;
};

exports.updateUser = (id, data) => {
  const existing = db.prepare(`
    SELECT * FROM users WHERE id = ?
  `).get(id);

  if (!existing) throw new Error("User not found");

  if (data.email && data.email !== existing.email) {
    const duplicate = db.prepare(`
      SELECT id FROM users WHERE email = ? AND id != ?
    `).get(data.email, id);

    if (duplicate) throw new Error("User email already exists");
  }

  if (data.role_id) {
    const role = db.prepare(`
      SELECT id FROM roles WHERE id = ?
    `).get(data.role_id);

    if (!role) throw new Error("Role not found");
  }

  const updateUserStatement = db.prepare(`
    UPDATE users
    SET email = ?, password_hash = ?, name = ?
    WHERE id = ?
  `);
  const updateMembershipRoles = db.prepare(`
    UPDATE project_members
    SET role_id = ?
    WHERE user_id = ?
  `);

  const transaction = db.transaction(() => {
    updateUserStatement.run(
      data.email ?? existing.email,
      data.password_hash ?? existing.password_hash,
      data.name ?? existing.name,
      id
    );

    if (data.role_id) {
      updateMembershipRoles.run(data.role_id, id);
    }
  });

  transaction();

  return { updated: true };
};

exports.deleteUser = (id) => {
  const user = db.prepare(`
    SELECT id FROM users WHERE id = ?
  `).get(id);

  if (!user) throw new Error("User not found");

  const dependencies = [
    { table: "projects", field: "created_by", message: "Cannot delete user with created projects" },
    { table: "executions", field: "created_by", message: "Cannot delete user with executions" },
    { table: "execution_results", field: "executed_by", message: "Cannot delete user with execution results" }
  ];

  for (const dependency of dependencies) {
    const used = db.prepare(`
      SELECT id FROM ${dependency.table} WHERE ${dependency.field} = ?
    `).get(id);

    if (used) {
      throw new Error(dependency.message);
    }
  }

  db.prepare(`
    DELETE FROM project_members
    WHERE user_id = ?
  `).run(id);

  db.prepare(`
    DELETE FROM users WHERE id = ?
  `).run(id);

  return { deleted: true };
};
