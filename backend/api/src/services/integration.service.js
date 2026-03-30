const db = require("../db");
const { v4: uuid } = require("uuid");

const VALID_TYPES = ["llm", "jira"];

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeIntegration = (integration) => {
  if (!integration) {
    return integration;
  }

  return {
    ...integration,
    is_active: Boolean(integration.is_active)
  };
};

const validateType = (type) => {
  if (!VALID_TYPES.includes(type)) {
    throw new Error(`Unsupported integration type: ${type}`);
  }
};

const validatePayload = (payload) => {
  const type = normalizeText(payload.type);
  const name = normalizeText(payload.name);
  const base_url = normalizeText(payload.base_url);
  const api_key = normalizeText(payload.api_key);
  const model = normalizeText(payload.model);
  const project_key = normalizeText(payload.project_key);
  const username = normalizeText(payload.username);
  const is_active = payload.is_active !== undefined ? Boolean(payload.is_active) : true;

  validateType(type);

  if (!name) {
    throw new Error("Integration name is required");
  }

  if (type === "llm") {
    if (!api_key) {
      throw new Error("LLM integrations require an API key");
    }

    if (!model) {
      throw new Error("LLM integrations require a model");
    }
  }

  if (type === "jira") {
    if (!base_url) {
      throw new Error("Jira integrations require a base URL");
    }

    if (!api_key) {
      throw new Error("Jira integrations require an API key");
    }
  }

  return {
    type,
    name,
    base_url,
    api_key,
    model,
    project_key,
    username,
    is_active
  };
};

exports.createIntegration = async (input) => {
  const payload = validatePayload(input);
  const id = uuid();

  await db.prepare(`
    INSERT INTO integrations (id, type, name, base_url, api_key, model, project_key, username, is_active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    id,
    payload.type,
    payload.name,
    payload.base_url,
    payload.api_key,
    payload.model,
    payload.project_key,
    payload.username,
    payload.is_active
  );

  return { id };
};

exports.getIntegrations = async ({ type, is_active } = {}) => {
  let query = `
    SELECT *
    FROM integrations
    WHERE 1=1
  `;
  const params = [];

  if (type) {
    validateType(type);
    query += ` AND type = ?`;
    params.push(type);
  }

  if (is_active !== undefined) {
    query += ` AND is_active = ?`;
    params.push(Boolean(is_active));
  }

  query += ` ORDER BY is_active DESC, updated_at DESC, created_at DESC, name ASC`;

  const rows = await db.prepare(query).all(...params);
  return rows.map(normalizeIntegration);
};

exports.getIntegration = async (id) => {
  const integration = await db.prepare(`
    SELECT *
    FROM integrations
    WHERE id = ?
  `).get(id);

  if (!integration) {
    throw new Error("Integration not found");
  }

  return normalizeIntegration(integration);
};

exports.getActiveIntegrationByType = async (type) => {
  validateType(type);

  const integration = await db.prepare(`
    SELECT *
    FROM integrations
    WHERE type = ? AND is_active = TRUE
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `).get(type);

  return normalizeIntegration(integration || null);
};

exports.updateIntegration = async (id, input) => {
  const existing = await exports.getIntegration(id);
  const payload = validatePayload({
    type: input.type ?? existing.type,
    name: input.name ?? existing.name,
    base_url: input.base_url ?? existing.base_url,
    api_key: input.api_key ?? existing.api_key,
    model: input.model ?? existing.model,
    project_key: input.project_key ?? existing.project_key,
    username: input.username ?? existing.username,
    is_active: input.is_active ?? existing.is_active
  });

  await db.prepare(`
    UPDATE integrations
    SET type = ?, name = ?, base_url = ?, api_key = ?, model = ?, project_key = ?, username = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    payload.type,
    payload.name,
    payload.base_url,
    payload.api_key,
    payload.model,
    payload.project_key,
    payload.username,
    payload.is_active,
    id
  );

  return { updated: true };
};

exports.deleteIntegration = async (id) => {
  await exports.getIntegration(id);

  await db.prepare(`
    DELETE FROM integrations
    WHERE id = ?
  `).run(id);

  return { deleted: true };
};
