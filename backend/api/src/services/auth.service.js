const crypto = require("crypto");
const db = require("../db");
const { hashPassword, createToken, verifyToken } = require("../utils/token");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getSessionRole = (id) => {
  const row = db.prepare(`
    SELECT roles.name
    FROM project_members
    JOIN roles ON roles.id = project_members.role_id
    WHERE project_members.user_id = ?
    ORDER BY CASE roles.name WHEN 'admin' THEN 0 ELSE 1 END
    LIMIT 1
  `).get(id);

  return row?.name === "admin" ? "admin" : "member";
};

const selectUserForSession = (id) => {
  const user = db.prepare(`
    SELECT id, email, name, created_at
    FROM users
    WHERE id = ?
  `).get(id);

  if (!user) {
    return null;
  }

  return {
    ...user,
    role: getSessionRole(id)
  };
};

const ensureMemberRole = () => {
  const existing = db.prepare(`
    SELECT id
    FROM roles
    WHERE name = 'member'
  `).get();

  if (existing) {
    return existing.id;
  }

  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO roles (id, name)
    VALUES (?, 'member')
  `).run(id);

  return id;
};

const assignDefaultProjectMemberships = (userId) => {
  const memberRoleId = ensureMemberRole();
  const projects = db.prepare(`SELECT id FROM projects`).all();
  const existing = db.prepare(`
    SELECT id
    FROM project_members
    WHERE project_id = ? AND user_id = ?
  `);
  const insertMembership = db.prepare(`
    INSERT INTO project_members (id, project_id, user_id, role_id)
    VALUES (?, ?, ?, ?)
  `);

  projects.forEach((project) => {
    if (!existing.get(project.id, userId)) {
      insertMembership.run(crypto.randomUUID(), project.id, userId, memberRoleId);
    }
  });
};

exports.signup = ({ email, password, name }) => {
  if (!email || !password) {
    throw createError("Missing required fields", 400);
  }

  const existing = db.prepare(`
    SELECT id FROM users WHERE email = ?
  `).get(email);

  if (existing) {
    throw createError("User already exists", 409);
  }

  const id = crypto.randomUUID();
  const passwordHash = hashPassword(password);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, name)
    VALUES (?, ?, ?, ?)
  `).run(id, email, passwordHash, name || null);

  assignDefaultProjectMemberships(id);

  const user = selectUserForSession(id);

  return {
    token: createToken(user),
    user
  };
};

exports.login = ({ email, password }) => {
  if (!email || !password) {
    throw createError("Missing required fields", 400);
  }

  const user = db.prepare(`
    SELECT id, email, name, password_hash, created_at
    FROM users
    WHERE email = ?
  `).get(email);

  if (!user || user.password_hash !== hashPassword(password)) {
    throw createError("Invalid credentials", 401);
  }

  const sessionUser = selectUserForSession(user.id);

  return {
    token: createToken(sessionUser),
    user: sessionUser
  };
};

exports.getSession = (token) => {
  let payload;

  try {
    payload = verifyToken(token);
  } catch (error) {
    throw createError(error.message || "Invalid token", 401);
  }

  const user = selectUserForSession(payload.sub);

  if (!user) {
    throw createError("User not found", 404);
  }

  return {
    token,
    user
  };
};
