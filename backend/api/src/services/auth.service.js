const crypto = require("crypto");
const db = require("../db");
const { hashPassword, verifyPassword, createToken, verifyToken } = require("../utils/token");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getSessionRole = async (id) => {
  const row = await db.prepare(`
    SELECT roles.name
    FROM project_members
    JOIN roles ON roles.id = project_members.role_id
    WHERE project_members.user_id = ?
    ORDER BY CASE roles.name WHEN 'admin' THEN 0 ELSE 1 END
    LIMIT 1
  `).get(id);

  return row?.name || "member";
};

const selectUserForSession = async (id) => {
  const user = await db.prepare(`
    SELECT id, email, name, created_at
    FROM users
    WHERE id = ?
  `).get(id);

  if (!user) {
    return null;
  }

  return {
    ...user,
    role: await getSessionRole(id)
  };
};

const ensureMemberRole = async () => {
  const existing = await db.prepare(`
    SELECT id
    FROM roles
    WHERE name = 'member'
  `).get();

  if (existing) {
    return existing.id;
  }

  const id = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO roles (id, name)
    VALUES (?, 'member')
  `).run(id);

  return id;
};

const assignDefaultProjectMemberships = async (userId, roleId) => {
  // Use provided roleId or default to member role if not specified
  const finalRoleId = roleId || await ensureMemberRole();
  
  // Get only the first project (sample project) instead of all projects
  const firstProject = await db.prepare(`
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
  if (!await existing.get(firstProject.id, userId)) {
    await insertMembership.run(crypto.randomUUID(), firstProject.id, userId, finalRoleId);
  }
};

const normalizeEmail = (email) => {
  return email.toLowerCase().trim();
};

exports.signup = async ({ email, password, name, role }) => {
  if (!email || !password) {
    throw createError("Missing required fields", 400);
  }

  const normalizedEmail = normalizeEmail(email);

  const existing = await db.prepare(`
    SELECT id FROM users WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (existing) {
    throw createError("User already exists", 409);
  }

  const id = crypto.randomUUID();
  const passwordHash = hashPassword(password);

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, name)
    VALUES (?, ?, ?, ?)
  `).run(id, normalizedEmail, passwordHash, name || null);

  await assignDefaultProjectMemberships(id, role);

  const user = await selectUserForSession(id);

  return {
    token: createToken(user),
    user
  };
};

exports.login = async ({ email, password }) => {
  if (!email || !password) {
    throw createError("Missing required fields", 400);
  }

  const normalizedEmail = normalizeEmail(email);

  const user = await db.prepare(`
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

  const sessionUser = await selectUserForSession(user.id);

  return {
    token: createToken(sessionUser),
    user: sessionUser
  };
};

exports.getSession = async (token) => {
  let payload;

  try {
    payload = verifyToken(token);
  } catch (error) {
    throw createError(error.message || "Invalid token", 401);
  }

  const user = await selectUserForSession(payload.sub);

  if (!user) {
    throw createError("User not found", 404);
  }

  return {
    token,
    user
  };
};

exports.forgotPassword = async ({ email }) => {
  if (!email) {
    throw createError("Email is required", 400);
  }

  const normalizedEmail = normalizeEmail(email);

  const user = await db.prepare(`
    SELECT id FROM users WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (!user) {
    // Don't reveal if user exists for security
    return { success: true };
  }

  // Mark that a password reset was requested
  await db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      expires_at = excluded.expires_at,
      created_at = CURRENT_TIMESTAMP
  `).run(crypto.randomUUID(), user.id, "pending", new Date(Date.now() + 60 * 60 * 1000).toISOString());

  return { success: true };
};

exports.resetPassword = async ({ email, newPassword }) => {
  if (!email || !newPassword) {
    throw createError("Email and new password are required", 400);
  }

  if (newPassword.length < 6) {
    throw createError("Password must be at least 6 characters", 400);
  }

  const normalizedEmail = normalizeEmail(email);

  const user = await db.prepare(`
    SELECT id FROM users WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (!user) {
    throw createError("User not found", 404);
  }

  // Check if a reset was recently requested
  const resetRecord = await db.prepare(`
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

  await db.prepare(`
    UPDATE users SET password_hash = ? WHERE id = ?
  `).run(newPasswordHash, user.id);

  await db.prepare(`
    DELETE FROM password_reset_tokens WHERE user_id = ?
  `).run(user.id);

  const sessionUser = await selectUserForSession(user.id);

  return {
    token: createToken(sessionUser),
    user: sessionUser
  };
};

exports.assignDefaultProjectMemberships = assignDefaultProjectMemberships;
