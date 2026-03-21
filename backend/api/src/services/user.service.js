const db = require("../db");
const { v4: uuid } = require("uuid");

exports.createUser = ({ email, password_hash, name }) => {
  if (!email || !password_hash) {
    throw new Error("Missing required fields");
  }

  const existing = db.prepare(`
    SELECT id FROM users WHERE email = ?
  `).get(email);

  if (existing) throw new Error("User already exists");

  const id = uuid();

  db.prepare(`
    INSERT INTO users (id, email, password_hash, name)
    VALUES (?, ?, ?, ?)
  `).run(id, email, password_hash, name || null);

  return { id };
};

exports.getUsers = () => {
  return db.prepare(`
    SELECT id, email, name, created_at FROM users
    ORDER BY created_at DESC
  `).all();
};

exports.getUser = (id) => {
  const user = db.prepare(`
    SELECT id, email, name, created_at
    FROM users
    WHERE id = ?
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

  db.prepare(`
    UPDATE users
    SET email = ?, password_hash = ?, name = ?
    WHERE id = ?
  `).run(
    data.email ?? existing.email,
    data.password_hash ?? existing.password_hash,
    data.name ?? existing.name,
    id
  );

  return { updated: true };
};

exports.deleteUser = (id) => {
  const user = db.prepare(`
    SELECT id FROM users WHERE id = ?
  `).get(id);

  if (!user) throw new Error("User not found");

  const dependencies = [
    { table: "projects", field: "created_by", message: "Cannot delete user with created projects" },
    { table: "project_members", field: "user_id", message: "Cannot delete user with project memberships" },
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
    DELETE FROM users WHERE id = ?
  `).run(id);

  return { deleted: true };
};
