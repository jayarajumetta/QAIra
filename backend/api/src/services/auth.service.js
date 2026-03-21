const db = require("../db");
const { v4: uuid } = require("uuid");
const { hashPassword, createToken, verifyToken } = require("../utils/token");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const selectUserForSession = (id) => {
  return db.prepare(`
    SELECT id, email, name, created_at
    FROM users
    WHERE id = ?
  `).get(id);
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

  const id = uuid();
  const passwordHash = hashPassword(password);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, name)
    VALUES (?, ?, ?, ?)
  `).run(id, email, passwordHash, name || null);

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

  if (!user) {
    throw createError("Invalid credentials", 401);
  }

  if (user.password_hash !== hashPassword(password)) {
    throw createError("Invalid credentials", 401);
  }

  return {
    token: createToken(user),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      created_at: user.created_at
    }
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
