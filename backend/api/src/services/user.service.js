const db = require("../db");
const { v4: uuid } = require("uuid");
const workspaceTransactionService = require("./workspaceTransaction.service");
const { hashPassword } = require("../utils/token");

const normalizeEmail = (email) => {
  return email.toLowerCase().trim();
};

const normalizeName = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Name must be a string");
  }

  const normalized = value.trim();
  return normalized || null;
};

const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i;
const MAX_AVATAR_DATA_URL_LENGTH = 2_000_000;

const selectRoleById = db.prepare(`
  SELECT id, name FROM roles WHERE id = ?
`);

const selectRoleByName = db.prepare(`
  SELECT id, name FROM roles WHERE LOWER(name) = LOWER(?)
`);

const normalizeAvatarDataUrl = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Avatar image must be provided as a data URL");
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_AVATAR_DATA_URL_LENGTH) {
    throw new Error("Avatar image is too large. Upload a smaller image and try again.");
  }

  if (!IMAGE_DATA_URL_PATTERN.test(normalized)) {
    throw new Error("Avatar image must be a valid base64-encoded image data URL.");
  }

  return normalized;
};

exports.createUser = async ({ email, password_hash, name, role_id }) => {
  if (!email || !password_hash || !role_id) {
    throw new Error("Missing required fields");
  }

  const normalizedEmail = normalizeEmail(email);

  const existing = await db.prepare(`
    SELECT id FROM users WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (existing) throw new Error("User already exists");

  const role = await db.prepare(`
    SELECT id FROM roles WHERE id = ?
  `).get(role_id);

  if (!role) throw new Error("Role not found");

  const id = uuid();

  const createUserStatement = db.prepare(`
    INSERT INTO users (id, email, password_hash, name)
    VALUES (?, ?, ?, ?)
  `);
  const projects = await db.prepare(`SELECT id FROM projects`).all();
  const createMembership = db.prepare(`
    INSERT INTO project_members (id, project_id, user_id, role_id)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(async () => {
    await createUserStatement.run(id, normalizedEmail, password_hash, normalizeName(name));

    for (const project of projects) {
      await createMembership.run(uuid(), project.id, id, role_id);
    }
  });

  await transaction();

  return { id };
};

exports.getUsers = async () => {
  return db.prepare(`
    SELECT users.id, users.email, users.name, users.avatar_data_url, users.created_at,
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

exports.getUser = async (id) => {
  const user = await db.prepare(`
    SELECT users.id, users.email, users.name, users.avatar_data_url, users.created_at,
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

exports.updateUser = async (id, data) => {
  const existing = await db.prepare(`
    SELECT * FROM users WHERE id = ?
  `).get(id);

  if (!existing) throw new Error("User not found");

  if (data.email && data.email !== existing.email) {
    const normalizedNewEmail = normalizeEmail(data.email);
    const normalizedExistingEmail = normalizeEmail(existing.email);
    
    if (normalizedNewEmail !== normalizedExistingEmail) {
      const duplicate = await db.prepare(`
        SELECT id FROM users WHERE LOWER(email) = ? AND id != ?
      `).get(normalizedNewEmail, id);

      if (duplicate) throw new Error("User email already exists");
    }
  }

  if (data.role_id) {
    const role = await db.prepare(`
      SELECT id FROM roles WHERE id = ?
    `).get(data.role_id);

    if (!role) throw new Error("Role not found");
  }

  const nextAvatarDataUrl =
    data.avatar_data_url !== undefined
      ? normalizeAvatarDataUrl(data.avatar_data_url)
      : existing.avatar_data_url;
  const nextName =
    data.name !== undefined
      ? normalizeName(data.name)
      : existing.name;

  const updateUserStatement = db.prepare(`
    UPDATE users
    SET email = ?, password_hash = ?, name = ?, avatar_data_url = ?
    WHERE id = ?
  `);
  const updateMembershipRoles = db.prepare(`
    UPDATE project_members
    SET role_id = ?
    WHERE user_id = ?
  `);

  const transaction = db.transaction(async () => {
    const emailToUpdate = data.email ? normalizeEmail(data.email) : existing.email;
    await updateUserStatement.run(
      emailToUpdate,
      data.password_hash ?? existing.password_hash,
      nextName,
      nextAvatarDataUrl,
      id
    );

    if (data.role_id) {
      await updateMembershipRoles.run(data.role_id, id);
    }
  });

  await transaction();

  return { updated: true };
};

exports.deleteUser = async (id) => {
  const user = await db.prepare(`
    SELECT id FROM users WHERE id = ?
  `).get(id);

  if (!user) throw new Error("User not found");

  const dependencies = [
    { table: "projects", field: "created_by", message: "Cannot delete user with created projects" },
    { table: "executions", field: "created_by", message: "Cannot delete user with executions" },
    { table: "executions", field: "assigned_to", message: "Cannot delete user assigned to executions" },
    { table: "execution_results", field: "executed_by", message: "Cannot delete user with execution results" }
  ];

  for (const dependency of dependencies) {
    const used = await db.prepare(`
      SELECT id FROM ${dependency.table} WHERE ${dependency.field} = ?
    `).get(id);

    if (used) {
      throw new Error(dependency.message);
    }
  }

  await db.prepare(`
    DELETE FROM project_members
    WHERE user_id = ?
  `).run(id);

  await db.prepare(`
    DELETE FROM users WHERE id = ?
  `).run(id);

  return { deleted: true };
};

const normalizeImportValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
};

const resolveImportRoleId = async (row, defaultRoleId) => {
  const directRoleId = normalizeImportValue(row?.role_id ?? row?.roleId);

  if (directRoleId) {
    const role = await selectRoleById.get(directRoleId);

    if (!role) {
      throw new Error(`Role not found: ${directRoleId}`);
    }

    return role.id;
  }

  const roleName = normalizeImportValue(row?.role);

  if (roleName) {
    const role = await selectRoleByName.get(roleName);

    if (!role) {
      throw new Error(`Role not found: ${roleName}`);
    }

    return role.id;
  }

  if (defaultRoleId) {
    const role = await selectRoleById.get(defaultRoleId);

    if (!role) {
      throw new Error("Default role not found");
    }

    return role.id;
  }

  throw new Error("Each imported user must include a role or you must choose a default role.");
};

const resolveImportPasswordHash = (row) => {
  const existingHash = normalizeImportValue(row?.password_hash ?? row?.passwordHash);

  if (existingHash) {
    return existingHash;
  }

  const password = normalizeImportValue(row?.password);

  if (!password) {
    throw new Error("Each imported user must include a password or password hash.");
  }

  return hashPassword(password);
};

exports.bulkImportUsers = async ({ rows = [], default_role_id, created_by } = {}) => {
  const defaultRoleId = normalizeImportValue(default_role_id);

  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("At least one CSV row is required");
  }

  if (defaultRoleId) {
    const role = await selectRoleById.get(defaultRoleId);

    if (!role) {
      throw new Error("Default role not found");
    }
  }

  const transaction = await workspaceTransactionService.createTransaction({
    category: "bulk_import",
    action: "user_import",
    status: "running",
    title: "Bulk user import",
    description: `Importing ${rows.length} user${rows.length === 1 ? "" : "s"} from CSV.`,
    metadata: {
      import_source: "csv",
      total_rows: rows.length
    },
    created_by,
    started_at: new Date().toISOString()
  });

  const created = [];
  const errors = [];

  for (const [index, row] of rows.entries()) {
    const email = normalizeImportValue(row?.email);

    try {
      if (!email) {
        throw new Error("Email is required");
      }

      const roleId = await resolveImportRoleId(row, defaultRoleId);
      const password_hash = resolveImportPasswordHash(row);
      const response = await exports.createUser({
        email,
        password_hash,
        name: normalizeImportValue(row?.name),
        role_id: roleId
      });

      created.push({
        row: index + 1,
        id: response.id,
        email
      });
    } catch (error) {
      errors.push({
        row: index + 1,
        email,
        message: error.message || "Unable to import user"
      });
    }
  }

  await workspaceTransactionService.updateTransaction(transaction.id, {
    status: created.length ? "completed" : "failed",
    description: created.length
      ? `Imported ${created.length} of ${rows.length} user${rows.length === 1 ? "" : "s"} from CSV.`
      : "No users were imported from the CSV file.",
    metadata: {
      import_source: "csv",
      total_rows: rows.length,
      imported: created.length,
      failed: errors.length,
      default_role_id: defaultRoleId
    },
    completed_at: new Date().toISOString()
  });

  return {
    imported: created.length,
    failed: errors.length,
    created,
    errors
  };
};
