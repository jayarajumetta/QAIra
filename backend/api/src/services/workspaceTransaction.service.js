const db = require("../db");
const { v4: uuid } = require("uuid");

const WORKSPACE_TRANSACTION_STATUSES = new Set(["queued", "running", "completed", "failed"]);

const selectTransaction = db.prepare(`
  SELECT
    workspace_transactions.*,
    users.email AS created_user_email,
    users.name AS created_user_name,
    users.avatar_data_url AS created_user_avatar_data_url
  FROM workspace_transactions
  LEFT JOIN users ON users.id = workspace_transactions.created_by
  WHERE workspace_transactions.id = ?
`);

const selectTransactionByRelated = db.prepare(`
  SELECT
    workspace_transactions.*,
    users.email AS created_user_email,
    users.name AS created_user_name,
    users.avatar_data_url AS created_user_avatar_data_url
  FROM workspace_transactions
  LEFT JOIN users ON users.id = workspace_transactions.created_by
  WHERE workspace_transactions.related_kind = ?
    AND workspace_transactions.related_id = ?
  ORDER BY workspace_transactions.created_at DESC, workspace_transactions.id DESC
  LIMIT 1
`);

const insertTransaction = db.prepare(`
  INSERT INTO workspace_transactions (
    id,
    project_id,
    app_type_id,
    category,
    action,
    status,
    title,
    description,
    metadata,
    related_kind,
    related_id,
    created_by,
    started_at,
    completed_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateTransaction = db.prepare(`
  UPDATE workspace_transactions
  SET project_id = ?,
      app_type_id = ?,
      category = ?,
      action = ?,
      status = ?,
      title = ?,
      description = ?,
      metadata = ?,
      related_kind = ?,
      related_id = ?,
      created_by = ?,
      started_at = ?,
      completed_at = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const normalizeText = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
};

const normalizeMetadata = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [key, entry]) => {
    const normalizedKey = String(key || "").trim();

    if (!normalizedKey) {
      return accumulator;
    }

    accumulator[normalizedKey] = entry;
    return accumulator;
  }, {});
};

const normalizeStatus = (value, fallback = "completed") => {
  const normalized = String(value || "").trim().toLowerCase();
  return WORKSPACE_TRANSACTION_STATUSES.has(normalized) ? normalized : fallback;
};

const normalizeTimestamp = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const parseJsonValue = (value, fallback) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
};

const hydrateTransaction = (transaction) => {
  if (!transaction) {
    return null;
  }

  return {
    ...transaction,
    metadata: parseJsonValue(transaction.metadata, {}),
    created_user: transaction.created_by
      ? {
          id: transaction.created_by,
          email: transaction.created_user_email,
          name: transaction.created_user_name || null,
          avatar_data_url: transaction.created_user_avatar_data_url || null
        }
      : null
  };
};

exports.createTransaction = async (input = {}) => {
  const id = uuid();

  await insertTransaction.run(
    id,
    normalizeText(input.project_id) || null,
    normalizeText(input.app_type_id) || null,
    normalizeText(input.category) || "general",
    normalizeText(input.action) || "event",
    normalizeStatus(input.status, "completed"),
    normalizeText(input.title) || "Workspace transaction",
    normalizeText(input.description) || null,
    normalizeMetadata(input.metadata),
    normalizeText(input.related_kind) || null,
    normalizeText(input.related_id) || null,
    normalizeText(input.created_by) || null,
    normalizeTimestamp(input.started_at) || null,
    normalizeTimestamp(input.completed_at) || null
  );

  return { id };
};

exports.getTransaction = async (id) => {
  const transaction = await selectTransaction.get(id);

  if (!transaction) {
    throw new Error("Workspace transaction not found");
  }

  return hydrateTransaction(transaction);
};

exports.findTransactionByRelated = async ({ related_kind, related_id }) => {
  if (!related_kind || !related_id) {
    return null;
  }

  return hydrateTransaction(await selectTransactionByRelated.get(related_kind, related_id));
};

exports.updateTransaction = async (id, updates = {}) => {
  const existing = await exports.getTransaction(id);
  const metadata =
    updates.metadata === undefined
      ? existing.metadata
      : { ...existing.metadata, ...normalizeMetadata(updates.metadata) };

  await updateTransaction.run(
    normalizeText(updates.project_id) ?? existing.project_id,
    normalizeText(updates.app_type_id) ?? existing.app_type_id,
    normalizeText(updates.category) ?? existing.category,
    normalizeText(updates.action) ?? existing.action,
    updates.status !== undefined ? normalizeStatus(updates.status, existing.status) : existing.status,
    normalizeText(updates.title) ?? existing.title,
    normalizeText(updates.description) ?? existing.description,
    metadata,
    normalizeText(updates.related_kind) ?? existing.related_kind,
    normalizeText(updates.related_id) ?? existing.related_id,
    normalizeText(updates.created_by) ?? existing.created_by,
    normalizeTimestamp(updates.started_at) ?? existing.started_at,
    normalizeTimestamp(updates.completed_at) ?? existing.completed_at,
    id
  );

  return exports.getTransaction(id);
};

exports.listTransactions = async ({
  project_id,
  app_type_id,
  category,
  limit = 20
} = {}) => {
  let query = `
    SELECT
      workspace_transactions.*,
      users.email AS created_user_email,
      users.name AS created_user_name,
      users.avatar_data_url AS created_user_avatar_data_url
    FROM workspace_transactions
    LEFT JOIN users ON users.id = workspace_transactions.created_by
    WHERE 1 = 1
  `;
  const params = [];

  if (project_id) {
    query += ` AND workspace_transactions.project_id = ?`;
    params.push(project_id);
  }

  if (app_type_id) {
    query += ` AND workspace_transactions.app_type_id = ?`;
    params.push(app_type_id);
  }

  if (category) {
    query += ` AND workspace_transactions.category = ?`;
    params.push(category);
  }

  query += ` ORDER BY COALESCE(workspace_transactions.updated_at, workspace_transactions.created_at) DESC, workspace_transactions.id DESC LIMIT ?`;
  params.push(Math.max(1, Math.min(100, Number(limit) || 20)));

  const rows = await db.prepare(query).all(...params);
  return rows.map(hydrateTransaction);
};
