const db = require("../db");
const { v4: uuid } = require("uuid");
const { INTEGRATION_TYPE_OPTIONS, INTEGRATION_TYPE_VALUES } = require("../domain/catalog");

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const normalizeObject = (value) => {
  return isPlainObject(value) ? value : {};
};

const normalizeInteger = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const normalizeScheduleMode = (value, fallback = "manual") => {
  const normalized = normalizeText(value);
  return ["manual", "hourly", "daily", "weekly"].includes(normalized) ? normalized : fallback;
};

const normalizeTestEngineBrowser = (value, fallback = "chromium") => {
  const normalized = normalizeText(value);
  return ["chromium", "firefox", "webkit"].includes(normalized) ? normalized : fallback;
};

const normalizeTestEngineTraceMode = (value, fallback = "on-first-retry") => {
  const normalized = normalizeText(value);
  return ["off", "on", "on-first-retry", "retain-on-failure"].includes(normalized) ? normalized : fallback;
};

const normalizeTestEngineVideoMode = (value, fallback = "retain-on-failure") => {
  const normalized = normalizeText(value);
  return ["off", "on", "retain-on-failure"].includes(normalized) ? normalized : fallback;
};

const normalizeConfig = (type, input, username) => {
  const raw = normalizeObject(input);
  const integrationTypeConfig = INTEGRATION_TYPE_OPTIONS.find((option) => option.value === type)?.defaults || {};

  if (type === "email") {
    const host = normalizeText(raw.host);
    const port = normalizeInteger(raw.port);
    const password = normalizeText(raw.password);
    const secure = Boolean(raw.secure);
    const sender_email = normalizeText(raw.sender_email) || integrationTypeConfig.sender_email || null;
    const sender_name = normalizeText(raw.sender_name) || integrationTypeConfig.sender_name || null;

    if (!host) {
      throw new Error("Email integrations require an SMTP host");
    }

    if (!port || port <= 0) {
      throw new Error("Email integrations require a valid SMTP port");
    }

    if (!username) {
      throw new Error("Email integrations require an SMTP username or email");
    }

    if (!password) {
      throw new Error("Email integrations require an SMTP password");
    }

    return {
      host,
      port,
      secure,
      password,
      sender_email,
      sender_name
    };
  }

  if (type === "google_auth") {
    const client_id = normalizeText(raw.client_id);

    if (!client_id) {
      throw new Error("Google sign-in integrations require a Google client ID");
    }

    return {
      client_id
    };
  }

  if (type === "google_drive") {
    const project_id = normalizeText(raw.project_id);
    const folder_id = normalizeText(raw.folder_id);

    if (!project_id) {
      throw new Error("Google Drive backup integrations require a project");
    }

    if (!folder_id) {
      throw new Error("Google Drive backup integrations require a Drive folder ID");
    }

    return {
      project_id,
      folder_id,
      schedule_mode: normalizeScheduleMode(raw.schedule_mode),
      include_requirements_csv: raw.include_requirements_csv !== false,
      include_test_cases_csv: raw.include_test_cases_csv !== false,
      next_sync_at: normalizeText(raw.next_sync_at),
      last_synced_at: normalizeText(raw.last_synced_at),
      last_sync_status: normalizeText(raw.last_sync_status),
      last_sync_transaction_id: normalizeText(raw.last_sync_transaction_id),
      last_sync_summary: normalizeText(raw.last_sync_summary)
    };
  }

  if (type === "github") {
    const project_id = normalizeText(raw.project_id);
    const owner = normalizeText(raw.owner);
    const repo = normalizeText(raw.repo);

    if (!project_id) {
      throw new Error("GitHub sync integrations require a project");
    }

    if (!owner || !repo) {
      throw new Error("GitHub sync integrations require both repository owner and repository name");
    }

    return {
      project_id,
      owner,
      repo,
      branch: normalizeText(raw.branch) || "main",
      directory: normalizeText(raw.directory) || "qaira-sync",
      file_extension: normalizeText(raw.file_extension) || "ts",
      schedule_mode: normalizeScheduleMode(raw.schedule_mode),
      next_sync_at: normalizeText(raw.next_sync_at),
      last_synced_at: normalizeText(raw.last_synced_at),
      last_sync_status: normalizeText(raw.last_sync_status),
      last_sync_transaction_id: normalizeText(raw.last_sync_transaction_id),
      last_sync_summary: normalizeText(raw.last_sync_summary)
    };
  }

  if (type === "testengine") {
    const project_id = normalizeText(raw.project_id);
    const callback_url = normalizeText(raw.callback_url);
    const callback_secret = normalizeText(raw.callback_secret);
    const max_repair_attempts = normalizeInteger(raw.max_repair_attempts) ?? Number(integrationTypeConfig.max_repair_attempts ?? 2);
    const artifact_retention_days = normalizeInteger(raw.artifact_retention_days) ?? Number(integrationTypeConfig.artifact_retention_days ?? 14);
    const run_timeout_seconds = normalizeInteger(raw.run_timeout_seconds) ?? Number(integrationTypeConfig.run_timeout_seconds ?? 1800);

    if (!project_id) {
      throw new Error("Test Engine integrations require a project");
    }

    if (!callback_url) {
      throw new Error("Test Engine integrations require a QAira callback URL");
    }

    if (!callback_secret) {
      throw new Error("Test Engine integrations require a callback signing secret");
    }

    if (!max_repair_attempts || max_repair_attempts < 0) {
      throw new Error("Test Engine integrations require a valid max repair attempt count");
    }

    if (!artifact_retention_days || artifact_retention_days <= 0) {
      throw new Error("Test Engine integrations require a valid artifact retention window");
    }

    if (!run_timeout_seconds || run_timeout_seconds <= 0) {
      throw new Error("Test Engine integrations require a valid run timeout");
    }

    return {
      project_id,
      callback_url,
      callback_secret,
      runner: "playwright",
      browser: normalizeTestEngineBrowser(raw.browser, String(integrationTypeConfig.browser || "chromium")),
      headless: raw.headless !== false,
      healing_enabled: raw.healing_enabled !== false,
      max_repair_attempts,
      trace_mode: normalizeTestEngineTraceMode(raw.trace_mode, String(integrationTypeConfig.trace_mode || "on-first-retry")),
      video_mode: normalizeTestEngineVideoMode(raw.video_mode, String(integrationTypeConfig.video_mode || "retain-on-failure")),
      capture_console: raw.capture_console !== false,
      capture_network: raw.capture_network !== false,
      artifact_retention_days,
      run_timeout_seconds,
      promote_healed_patches: normalizeText(raw.promote_healed_patches) || String(integrationTypeConfig.promote_healed_patches || "review")
    };
  }

  return {};
};

const normalizeIntegration = (integration) => {
  if (!integration) {
    return integration;
  }

  return {
    ...integration,
    is_active: Boolean(integration.is_active),
    config: isPlainObject(integration.config) ? integration.config : {}
  };
};

const validateType = (type) => {
  if (!INTEGRATION_TYPE_VALUES.includes(type)) {
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

  if (type === "google_drive" || type === "github") {
    if (!api_key) {
      throw new Error(`${type === "google_drive" ? "Google Drive" : "GitHub"} integrations require an access token`);
    }
  }

  if (type === "testengine") {
    if (!base_url) {
      throw new Error("Test Engine integrations require a host URL");
    }

    if (!api_key) {
      throw new Error("Test Engine integrations require an engine access token");
    }
  }

  const config = normalizeConfig(type, payload.config, username);

  return {
    type,
    name,
    base_url,
    api_key,
    model,
    project_key,
    username,
    config,
    is_active
  };
};

exports.createIntegration = async (input) => {
  const payload = validatePayload(input);
  const id = uuid();

  await db.prepare(`
    INSERT INTO integrations (id, type, name, base_url, api_key, model, project_key, username, config, is_active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    id,
    payload.type,
    payload.name,
    payload.base_url,
    payload.api_key,
    payload.model,
    payload.project_key,
    payload.username,
    payload.config,
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

exports.getActiveIntegrationByTypeForProject = async (type, projectId) => {
  validateType(type);

  const normalizedProjectId = normalizeText(projectId);

  if (!normalizedProjectId) {
    return null;
  }

  const integration = await db.prepare(`
    SELECT *
    FROM integrations
    WHERE type = ?
      AND is_active = TRUE
      AND config->>'project_id' = ?
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `).get(type, normalizedProjectId);

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
    config: input.config ?? existing.config,
    is_active: input.is_active ?? existing.is_active
  });

  await db.prepare(`
    UPDATE integrations
    SET type = ?, name = ?, base_url = ?, api_key = ?, model = ?, project_key = ?, username = ?, config = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    payload.type,
    payload.name,
    payload.base_url,
    payload.api_key,
    payload.model,
    payload.project_key,
    payload.username,
    payload.config,
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

exports.mergeIntegrationConfig = async (id, configUpdates = {}) => {
  const existing = await exports.getIntegration(id);
  const nextConfig = {
    ...(existing.config || {}),
    ...normalizeObject(configUpdates)
  };

  await db.prepare(`
    UPDATE integrations
    SET config = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(nextConfig, id);

  return exports.getIntegration(id);
};
