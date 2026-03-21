const db = require("../db");
const { v4: uuid } = require("uuid");

exports.createRole = ({ name }) => {
  if (!name) {
    throw new Error("Missing required fields");
  }

  const existing = db.prepare(`
    SELECT id FROM roles WHERE name = ?
  `).get(name);

  if (existing) throw new Error("Role already exists");

  const id = uuid();

  db.prepare(`
    INSERT INTO roles (id, name)
    VALUES (?, ?)
  `).run(id, name);

  return { id };
};

exports.getRoles = () => {
  return db.prepare(`
    SELECT * FROM roles
    ORDER BY name ASC
  `).all();
};

exports.getRole = (id) => {
  const role = db.prepare(`
    SELECT * FROM roles WHERE id = ?
  `).get(id);

  if (!role) throw new Error("Role not found");

  return role;
};

exports.updateRole = (id, data) => {
  const existing = exports.getRole(id);

  if (data.name && data.name !== existing.name) {
    const duplicate = db.prepare(`
      SELECT id FROM roles WHERE name = ? AND id != ?
    `).get(data.name, id);

    if (duplicate) throw new Error("Role already exists");
  }

  db.prepare(`
    UPDATE roles
    SET name = ?
    WHERE id = ?
  `).run(data.name ?? existing.name, id);

  return { updated: true };
};

exports.deleteRole = (id) => {
  exports.getRole(id);

  const used = db.prepare(`
    SELECT id FROM project_members WHERE role_id = ?
  `).get(id);

  if (used) {
    throw new Error("Cannot delete role assigned to project members");
  }

  db.prepare(`
    DELETE FROM roles WHERE id = ?
  `).run(id);

  return { deleted: true };
};
