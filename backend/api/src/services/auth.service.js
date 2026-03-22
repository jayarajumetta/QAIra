const crypto = require("crypto");
const db = require("../db");
const { hashPassword, verifyPassword, createToken, verifyToken } = require("../utils/token");

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

  return row?.name || "member";
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

const assignDefaultProjectMemberships = (userId, roleId) => {
  // Use provided roleId or default to member role if not specified
  const finalRoleId = roleId || ensureMemberRole();
  
  // Get only the first project (sample project) instead of all projects
  const firstProject = db.prepare(`
    SELECT id FROM projects 
    ORDER BY created_at ASC 
    LIMIT 1
  `).get();
  
  if (!firstProject) {
    // If no projects exist, skip membership assignment
    return;
  }
  
  const existing = db.prepare(`
    SELECT id
    FROM project_members
    WHERE project_id = ? AND user_id = ?
  `);
  const insertMembership = db.prepare(`
    INSERT INTO project_members (id, project_id, user_id, role_id)
    VALUES (?, ?, ?, ?)
  `);

  // Only add to first project
  if (!existing.get(firstProject.id, userId)) {
    insertMembership.run(crypto.randomUUID(), firstProject.id, userId, finalRoleId);
  }
};

const normalizeEmail = (email) => {
  return email.toLowerCase().trim();
};

exports.signup = ({ email, password, name, role }) => {
  if (!email || !password) {
    throw createError("Missing required fields", 400);
  }

  const normalizedEmail = normalizeEmail(email);

  const existing = db.prepare(`
    SELECT id FROM users WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (existing) {
    throw createError("User already exists", 409);
  }

  const id = crypto.randomUUID();
  const passwordHash = hashPassword(password);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, name)
    VALUES (?, ?, ?, ?)
  `).run(id, normalizedEmail, passwordHash, name || null);

  assignDefaultProjectMemberships(id, role);

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

  const normalizedEmail = normalizeEmail(email);

  const user = db.prepare(`
    SELECT id, email, name, password_hash, created_at
    FROM users
    WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (!user) {
    throw createError("Invalid credentials", 401);
  }

  // Use timing-safe comparison for password verification
  const isPasswordValid = verifyPassword(password, user.password_hash);
  
  if (!isPasswordValid) {
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

exports.forgotPassword = ({ email }) => {
  if (!email) {
    throw createError("Email is required", 400);
  }

  const normalizedEmail = normalizeEmail(email);

  const user = db.prepare(`
    SELECT id FROM users WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (!user) {
    // Don't reveal if user exists for security
    return { success: true };
  }

  // Mark that a password reset was requested
  db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      expires_at = excluded.expires_at,
      created_at = CURRENT_TIMESTAMP
  `).run(crypto.randomUUID(), user.id, "pending", new Date(Date.now() + 60 * 60 * 1000).toISOString());

  return { success: true };
};

exports.resetPassword = ({ email, newPassword }) => {
  if (!email || !newPassword) {
    throw createError("Email and new password are required", 400);
  }

  if (newPassword.length < 6) {
    throw createError("Password must be at least 6 characters", 400);
  }

  const normalizedEmail = normalizeEmail(email);

  const user = db.prepare(`
    SELECT id FROM users WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (!user) {
    throw createError("User not found", 404);
  }

  // Check if a reset was recently requested
  const resetRecord = db.prepare(`
    SELECT expires_at FROM password_reset_tokens WHERE user_id = ?
  `).get(user.id);

  if (!resetRecord) {
    throw createError("No password reset request found. Please request a password reset first.", 400);
  }

  const expiresAt = new Date(resetRecord.expires_at);
  if (expiresAt < new Date()) {
    throw createError("Password reset request has expired. Please request a new one.", 401);
  }

  // Update password and remove reset token
  const newPasswordHash = hashPassword(newPassword);

  db.prepare(`
    UPDATE users SET password_hash = ? WHERE id = ?
  `).run(newPasswordHash, user.id);

  db.prepare(`
    DELETE FROM password_reset_tokens WHERE user_id = ?
  `).run(user.id);

  const sessionUser = selectUserForSession(user.id);

  return {
    token: createToken(sessionUser),
    user: sessionUser
  };
};

exports.assignDefaultProjectMemberships = assignDefaultProjectMemberships;
