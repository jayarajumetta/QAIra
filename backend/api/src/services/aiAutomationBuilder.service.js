const db = require("../db");
const { v4: uuid } = require("uuid");
const integrationService = require("./integration.service");
const testStepService = require("./testStep.service");
const workspaceTransactionService = require("./workspaceTransaction.service");
const testEnvironmentService = require("./testEnvironment.service");
const testConfigurationService = require("./testConfiguration.service");
const testDataSetService = require("./testDataSet.service");
const {
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType,
  parseJsonValue
} = require("../utils/testStepAutomation");

const LLM_TIMEOUT_MS = Math.max(10_000, Number(process.env.AUTOMATION_BUILDER_LLM_TIMEOUT_MS || 90_000));
const ENGINE_TIMEOUT_MS = Math.max(2_000, Number(process.env.AUTOMATION_BUILDER_ENGINE_TIMEOUT_MS || 15_000));
const MAX_CACHE_ROWS = 40;
const MAX_CAPTURED_ACTIONS = 180;
const MAX_CAPTURED_NETWORK = 80;
const DEFAULT_BATCH_FAILURE_THRESHOLD = Math.max(1, Number(process.env.AUTOMATION_BUILDER_BATCH_FAILURE_THRESHOLD || 3));

const selectCaseWithScope = db.prepare(`
  SELECT
    test_cases.*,
    app_types.name AS app_type_name,
    app_types.type AS app_type_kind,
    app_types.project_id,
    projects.name AS project_name
  FROM test_cases
  LEFT JOIN app_types ON app_types.id = test_cases.app_type_id
  LEFT JOIN projects ON projects.id = app_types.project_id
  WHERE test_cases.id = ?
`);

const selectStepsForCase = db.prepare(`
  SELECT *
  FROM test_steps
  WHERE test_case_id = ?
  ORDER BY step_order ASC, id ASC
`);

const selectCasesForBatch = db.prepare(`
  SELECT test_cases.id
  FROM test_cases
  JOIN app_types ON app_types.id = test_cases.app_type_id
  WHERE test_cases.app_type_id = ?
    AND COALESCE(test_cases.automated, 'no') <> 'yes'
    AND app_types.type IN ('web', 'unified')
  ORDER BY COALESCE(test_cases.updated_at, test_cases.created_at) DESC, test_cases.created_at DESC, test_cases.id DESC
`);

const updateCaseAutomated = db.prepare(`
  UPDATE test_cases
  SET automated = 'yes',
      updated_by = COALESCE(?, updated_by),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const selectLearningCache = db.prepare(`
  SELECT *
  FROM automation_learning_cache
  WHERE (? IS NULL OR project_id = ?)
    AND (? IS NULL OR app_type_id = ?)
  ORDER BY hit_count DESC, updated_at DESC
  LIMIT ?
`);

const upsertLearningCache = db.prepare(`
  INSERT INTO automation_learning_cache (
    id,
    project_id,
    app_type_id,
    test_case_id,
    page_url,
    page_key,
    locator_intent,
    locator,
    locator_kind,
    confidence,
    source,
    metadata,
    hit_count
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT (app_type_id, page_key, locator_intent, locator)
  DO UPDATE SET
    project_id = COALESCE(EXCLUDED.project_id, automation_learning_cache.project_id),
    test_case_id = COALESCE(EXCLUDED.test_case_id, automation_learning_cache.test_case_id),
    page_url = COALESCE(EXCLUDED.page_url, automation_learning_cache.page_url),
    locator_kind = COALESCE(EXCLUDED.locator_kind, automation_learning_cache.locator_kind),
    confidence = GREATEST(automation_learning_cache.confidence, EXCLUDED.confidence),
    source = EXCLUDED.source,
    metadata = EXCLUDED.metadata,
    hit_count = automation_learning_cache.hit_count + 1,
    updated_at = CURRENT_TIMESTAMP
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeIdList = (values = []) =>
  [...new Set((Array.isArray(values) ? values : [values]).map((value) => normalizeText(value)).filter(Boolean))];

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const normalizeObject = (value) => (isPlainObject(value) ? value : {});

const clampNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const safeJson = (value, fallback) => parseJsonValue(value, fallback);

const summarizeVariables = (variables = []) =>
  (Array.isArray(variables) ? variables : [])
    .map((entry) => ({
      key: normalizeText(entry?.key),
      value: entry?.is_secret ? "[secret]" : String(entry?.value ?? ""),
      is_secret: Boolean(entry?.is_secret)
    }))
    .filter((entry) => entry.key);

const summarizeDataSetRows = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .slice(0, 5)
    .map((row) =>
      Object.entries(row).reduce((accumulator, [key, value]) => {
        const normalizedKey = normalizeText(key);

        if (!normalizedKey) {
          return accumulator;
        }

        accumulator[normalizedKey] = String(value ?? "");
        return accumulator;
      }, {})
    );

const ensureScopedBuildResource = (resource, testCase, label) => {
  if (!resource) {
    return null;
  }

  if (resource.project_id && testCase.project_id && resource.project_id !== testCase.project_id) {
    throw new Error(`${label} must belong to the same project as the test case`);
  }

  if (resource.app_type_id && testCase.app_type_id && resource.app_type_id !== testCase.app_type_id) {
    throw new Error(`${label} must belong to the same app type as the test case`);
  }

  return resource;
};

const resolveBuildContext = async ({
  testCase,
  test_environment_id,
  test_configuration_id,
  test_data_set_id
} = {}) => {
  const [environment, configuration, dataSet] = await Promise.all([
    normalizeText(test_environment_id) ? testEnvironmentService.getTestEnvironment(test_environment_id) : Promise.resolve(null),
    normalizeText(test_configuration_id) ? testConfigurationService.getTestConfiguration(test_configuration_id) : Promise.resolve(null),
    normalizeText(test_data_set_id) ? testDataSetService.getTestDataSet(test_data_set_id) : Promise.resolve(null)
  ]);
  const scopedEnvironment = ensureScopedBuildResource(environment, testCase, "Test environment");
  const scopedConfiguration = ensureScopedBuildResource(configuration, testCase, "Test configuration");
  const scopedDataSet = ensureScopedBuildResource(dataSet, testCase, "Test data");

  return {
    environment: scopedEnvironment
      ? {
          id: scopedEnvironment.id,
          name: scopedEnvironment.name,
          base_url: normalizeText(scopedEnvironment.base_url),
          browser: normalizeText(scopedEnvironment.browser),
          notes: normalizeRichText(scopedEnvironment.notes),
          variables: summarizeVariables(scopedEnvironment.variables)
        }
      : null,
    configuration: scopedConfiguration
      ? {
          id: scopedConfiguration.id,
          name: scopedConfiguration.name,
          browser: normalizeText(scopedConfiguration.browser),
          mobile_os: normalizeText(scopedConfiguration.mobile_os),
          platform_version: normalizeText(scopedConfiguration.platform_version),
          variables: summarizeVariables(scopedConfiguration.variables)
        }
      : null,
    data_set: scopedDataSet
      ? {
          id: scopedDataSet.id,
          name: scopedDataSet.name,
          mode: scopedDataSet.mode,
          columns: Array.isArray(scopedDataSet.columns) ? scopedDataSet.columns : [],
          rows: summarizeDataSetRows(scopedDataSet.rows),
          row_count: Array.isArray(scopedDataSet.rows) ? scopedDataSet.rows.length : 0
        }
      : null
  };
};

const extractJsonPayload = (content) => {
  const trimmed = String(content || "").trim();

  if (!trimmed) {
    throw new Error("LLM response was empty");
  }

  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    : trimmed;
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  const jsonCandidate =
    firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence;

  try {
    return JSON.parse(jsonCandidate);
  } catch {
    throw new Error("Unable to parse JSON from the LLM response");
  }
};

const fetchWithTimeout = async (url, init = {}, timeoutMs = LLM_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const resolveLlmIntegration = async (integrationId, { allowFallback = true } = {}) => {
  const integration = integrationId
    ? await integrationService.getIntegration(integrationId)
    : await integrationService.getActiveIntegrationByType("llm");

  if (!integration) {
    if (allowFallback) {
      return null;
    }

    throw new Error("No active LLM integration is configured");
  }

  if (integration.type !== "llm") {
    throw new Error("Selected integration is not an LLM integration");
  }

  if (!integration.is_active) {
    throw new Error("Selected LLM integration is inactive");
  }

  return integration;
};

const requestChatCompletion = async ({ integration, prompt }) => {
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${integration.api_key}`
    },
    body: JSON.stringify({
      model: integration.model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: [
            "You are QAira Pilot, a senior test automation engineer.",
            "Return strict JSON only.",
            "Generate deterministic QAira web keyword automation that runs in the QAira Test Engine Playwright facade.",
            "Never invent business assertions that are not present in the manual case."
          ].join(" ")
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  }, LLM_TIMEOUT_MS);

  if (!response.ok) {
    const raw = await response.text();
    const detail = raw.slice(0, 300).trim();
    const error = new Error(`LLM request failed with status ${response.status}${detail ? `: ${detail}` : ""}`);
    error.statusCode = response.status;
    throw error;
  }

  const payload = await response.json();
  const messageContent = payload?.choices?.[0]?.message?.content;

  if (!messageContent) {
    throw new Error("LLM response did not include generated content");
  }

  return messageContent;
};

const normalizeUrlKey = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return "unknown-page";
  }

  try {
    const parsed = new URL(normalized, "http://qaira.local");
    return `${parsed.pathname || "/"}`.replace(/\/+$/, "") || "/";
  } catch {
    return normalized.replace(/\?.*$/, "").replace(/\/+$/, "") || "unknown-page";
  }
};

const summarizeStep = (step) => ({
  id: step.id,
  order: Number(step.step_order || 0),
  type: step.step_type || "web",
  action: step.action || "",
  expected_result: step.expected_result || "",
  has_existing_automation: Boolean(normalizeRichText(step.automation_code) || normalizeApiRequest(step.api_request)),
  existing_automation_code: normalizeRichText(step.automation_code),
  existing_api_request: normalizeApiRequest(step.api_request)
});

const summarizeCache = (rows = []) =>
  rows.map((row) => ({
    page_key: row.page_key,
    page_url: row.page_url,
    intent: row.locator_intent,
    locator: row.locator,
    kind: row.locator_kind || "unknown",
    confidence: Number(row.confidence || 0),
    hit_count: Number(row.hit_count || 0)
  }));

const normalizeCapturedActions = (actions = []) =>
  (Array.isArray(actions) ? actions : [])
    .map((action, index) => ({
      index: Number.isFinite(Number(action?.index)) ? Number(action.index) : index + 1,
      type: normalizeText(action?.type) || "action",
      url: normalizeText(action?.url),
      locator: normalizeText(action?.locator),
      text: normalizeText(action?.text),
      value: normalizeText(action?.value),
      page_id: normalizeText(action?.page_id || action?.pageId),
      page_title: normalizeText(action?.page_title || action?.pageTitle),
      timestamp: normalizeText(action?.timestamp)
    }))
    .filter((action) => action.type || action.locator || action.text || action.value)
    .slice(-MAX_CAPTURED_ACTIONS);

const normalizeCapturedNetwork = (network = []) =>
  (Array.isArray(network) ? network : [])
    .map((entry) => ({
      method: normalizeText(entry?.method) || "GET",
      url: normalizeText(entry?.url),
      status: Number.isFinite(Number(entry?.status)) ? Number(entry.status) : null,
      resource_type: normalizeText(entry?.resource_type || entry?.resourceType),
      page_id: normalizeText(entry?.page_id || entry?.pageId),
      page_title: normalizeText(entry?.page_title || entry?.pageTitle),
      request_body: normalizeRichText(entry?.request_body || entry?.requestBody || entry?.post_data || entry?.postData),
      response_body_sample: normalizeRichText(entry?.response_body_sample || entry?.responseBodySample),
      content_type: normalizeText(entry?.content_type || entry?.contentType)
    }))
    .filter((entry) => entry.url && ["fetch", "xhr"].includes(String(entry.resource_type || "").toLowerCase()))
    .slice(-MAX_CAPTURED_NETWORK);

const buildPrompt = ({
  testCase,
  steps,
  cacheRows,
  capturedActions,
  capturedNetwork,
  buildContext,
  startUrl,
  additionalContext
}) => {
  const prompt = [
    "Build automation for this QAira manual web test case.",
    "",
    "Runtime contract:",
    "- Use QAira keyword/facade calls only: web.goto, web.click, web.fill, web.press, web.wait, web.expectVisible, web.expectText, web.expectUrl, capture.",
    "- Each step automation_code must be executable JavaScript statements, not a full Playwright test file.",
    "- Prefer semantic locators: getByRole-style text, labels, placeholders, data-testid, id/name, then CSS. In QAira keyword code pass the best target string to web.click/web.fill/etc.",
    "- Use @t.variable_name tokens when the manual case implies reusable data.",
    "- For API requests inferred from captured network, create api_request objects only for meaningful business API calls and ignore analytics, fonts, images, telemetry, auth refresh noise, and static assets.",
    "- Preserve the manual step sequence. Do not add hidden side-effect steps.",
    "- Reuse learning cache locators when they match the step intent and page.",
    "",
    "Return strict JSON with this shape:",
    "{",
    '  "summary": "string",',
    '  "base_url": "string or null",',
    '  "steps": [',
    "    {",
    '      "step_id": "string",',
    '      "step_order": 1,',
    '      "step_type": "web or api",',
    '      "automation_code": "await web.click(...);",',
    '      "api_request": null',
    "    }",
    "  ],",
    '  "learned_locators": [',
    "    {",
    '      "page_url": "string or null",',
    '      "page_key": "login",',
    '      "intent": "login submit button",',
    '      "locator": "button:has-text(\\"Sign in\\")",',
    '      "kind": "role|label|placeholder|testid|css|text",',
    '      "confidence": 0.88',
    "    }",
    "  ]",
    "}",
    "",
    `Project: ${testCase.project_name || testCase.project_id || "Unknown project"}`,
    `App type: ${testCase.app_type_name || testCase.app_type_id || "Unknown app"} (${testCase.app_type_kind || "web"})`,
    `Case: ${testCase.title}`,
    `Description: ${testCase.description || "No description provided."}`,
    `Start URL: ${startUrl || "Not provided"}`,
    "",
    "Execution context selected for automation:",
    JSON.stringify(buildContext || { environment: null, configuration: null, data_set: null }, null, 2),
    "",
    "Manual steps:",
    JSON.stringify(steps.map(summarizeStep), null, 2),
    "",
    "Reusable test data:",
    JSON.stringify(safeJson(testCase.parameter_values, {}), null, 2),
    "",
    "Learning cache:",
    JSON.stringify(summarizeCache(cacheRows), null, 2)
  ];

  if (capturedActions.length) {
    prompt.push("");
    prompt.push("Recorder actions:");
    prompt.push(JSON.stringify(capturedActions, null, 2));
  }

  if (capturedNetwork.length) {
    prompt.push("");
    prompt.push("Captured network requests:");
    prompt.push(JSON.stringify(capturedNetwork, null, 2));
  }

  if (additionalContext) {
    prompt.push("");
    prompt.push("Additional builder guidance:");
    prompt.push(additionalContext);
  }

  return prompt.join("\n");
};

const inferQuotedText = (value) => {
  const text = normalizeRichText(value);

  if (!text) {
    return null;
  }

  const quoteMatch = text.match(/["“']([^"”']{2,})["”']/);
  if (quoteMatch) {
    return quoteMatch[1].trim();
  }

  return null;
};

const inferLocatorText = (step) => {
  const action = normalizeRichText(step.action) || "";
  const quoted = inferQuotedText(action);

  if (quoted) {
    return quoted;
  }

  const matches = [
    action.match(/\b(?:click|tap|select|choose|open)\s+(?:on\s+)?(?:the\s+)?(.+)$/i),
    action.match(/\b(?:enter|type|fill|input)\s+.+?\s+(?:in|into|on)\s+(?:the\s+)?(.+)$/i),
    action.match(/\b(?:field|button|link|tab|menu)\s+(.+)$/i)
  ];

  for (const match of matches) {
    const candidate = normalizeRichText(match?.[1]);
    if (candidate) {
      return candidate.replace(/[.。]$/, "");
    }
  }

  return action.slice(0, 80) || `step ${step.step_order || 1}`;
};

const findCachedLocator = (step, cacheRows = []) => {
  const intent = `${step.action || ""} ${step.expected_result || ""}`.toLowerCase();

  return cacheRows.find((row) => {
    const haystack = `${row.locator_intent || ""} ${row.page_key || ""}`.toLowerCase();
    return haystack && intent && haystack.split(/\s+/).some((token) => token.length > 3 && intent.includes(token));
  })?.locator || null;
};

const buildDeterministicWebCode = (step, cacheRows, startUrl) => {
  const action = normalizeRichText(step.action) || "";
  const expected = normalizeRichText(step.expected_result) || "";
  const lower = action.toLowerCase();
  const cachedLocator = findCachedLocator(step, cacheRows);
  const target = cachedLocator || inferLocatorText(step);
  const lines = [];

  const urlMatch = action.match(/https?:\/\/\S+|\/[A-Za-z0-9_./?=&%-]+/);

  if (/\b(open|navigate|go to|launch)\b/i.test(action)) {
    lines.push(`await web.goto(${JSON.stringify(urlMatch?.[0] || startUrl || "/")});`);
  } else if (/\b(click|tap|select|choose)\b/i.test(action)) {
    lines.push(`await web.click(${JSON.stringify(target)});`);
  } else if (/\b(enter|type|fill|input)\b/i.test(action)) {
    const value = inferQuotedText(action) || "@t.value";
    lines.push(`await web.fill(${JSON.stringify(target)}, ${JSON.stringify(value)});`);
  } else if (/\b(wait)\b/i.test(action)) {
    lines.push("await web.wait(1000);");
  } else if (/\b(press)\b/i.test(action)) {
    lines.push(`await web.press(${JSON.stringify(target)}, "Enter");`);
  } else {
    lines.push(`await web.expectVisible(${JSON.stringify(target)});`);
  }

  if (expected) {
    const expectedQuoted = inferQuotedText(expected) || expected.replace(/^verify\s+(?:that\s+)?/i, "").slice(0, 120);

    if (/\b(url|redirect)\b/i.test(expected)) {
      lines.push(`await web.expectUrl(${JSON.stringify(expectedQuoted)});`);
    } else {
      lines.push(`await web.expectText("body", ${JSON.stringify(expectedQuoted)});`);
    }
  }

  return lines.join("\n");
};

const normalizeStepCandidate = (candidate, stepsById, stepsByOrder) => {
  if (!isPlainObject(candidate)) {
    return null;
  }

  const stepId = normalizeText(candidate.step_id || candidate.id);
  const stepOrder = Number(candidate.step_order || candidate.order);
  const step = stepId ? stepsById.get(stepId) : stepsByOrder.get(stepOrder);

  if (!step) {
    return null;
  }

  return {
    step,
    step_type: normalizeTestStepType(candidate.step_type || candidate.stepType, step.step_type || "web"),
    automation_code: normalizeRichText(candidate.automation_code || candidate.automationCode || candidate.code),
    api_request: normalizeApiRequest(candidate.api_request || candidate.apiRequest)
  };
};

const normalizeLlmBuild = (payload, steps, cacheRows, startUrl) => {
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const stepsByOrder = new Map(steps.map((step) => [Number(step.step_order || 0), step]));
  const candidates = Array.isArray(payload?.steps) ? payload.steps : [];
  const byStepId = new Map();

  candidates.forEach((candidate) => {
    const normalized = normalizeStepCandidate(candidate, stepsById, stepsByOrder);
    if (normalized) {
      byStepId.set(normalized.step.id, normalized);
    }
  });

  const updates = steps.map((step) => {
    const candidate = byStepId.get(step.id);
    const stepType = candidate?.step_type || normalizeTestStepType(step.step_type, "web");
    const automationCode = candidate?.automation_code
      || (stepType === "web" ? buildDeterministicWebCode(step, cacheRows, startUrl) : null);

    return {
      step,
      step_type: stepType,
      automation_code: automationCode,
      api_request: stepType === "api" ? candidate?.api_request || normalizeApiRequest(step.api_request) : null
    };
  }).filter((update) => update.automation_code || update.api_request);

  const learnedLocators = (Array.isArray(payload?.learned_locators) ? payload.learned_locators : [])
    .map((item) => ({
      page_url: normalizeText(item?.page_url || item?.pageUrl),
      page_key: normalizeText(item?.page_key || item?.pageKey) || normalizeUrlKey(item?.page_url || startUrl),
      locator_intent: normalizeText(item?.intent || item?.locator_intent || item?.name),
      locator: normalizeText(item?.locator),
      locator_kind: normalizeText(item?.kind || item?.locator_kind),
      confidence: Math.max(0, Math.min(1, clampNumber(item?.confidence, 0.5))),
      metadata: normalizeObject(item?.metadata)
    }))
    .filter((item) => item.page_key && item.locator_intent && item.locator);

  return {
    summary: normalizeRichText(payload?.summary) || "Automation generated for the manual test case.",
    base_url: normalizeText(payload?.base_url || payload?.baseUrl),
    updates,
    learned_locators: learnedLocators
  };
};

const buildFallbackBuild = (steps, cacheRows, startUrl, reason) => ({
  summary: `Generated keyword starter automation${reason ? ` without LLM completion: ${reason}` : "."}`,
  base_url: startUrl || null,
  updates: steps.map((step) => ({
    step,
    step_type: normalizeTestStepType(step.step_type, "web"),
    automation_code: buildDeterministicWebCode(step, cacheRows, startUrl),
    api_request: null
  })),
  learned_locators: []
});

const appendEvent = async (transactionId, event) => {
  if (!transactionId) {
    return;
  }

  await workspaceTransactionService.appendTransactionEvent(transactionId, event);
};

const updateTransaction = async (transactionId, patch) => {
  if (!transactionId) {
    return null;
  }

  return workspaceTransactionService.updateTransaction(transactionId, patch);
};

const createArtifactContent = ({ testCase, updates }) => {
  const lines = [
    `// QAira generated automation artifact`,
    `// Test case: ${testCase.title}`,
    `// Test case id: ${testCase.id}`,
    ""
  ];

  updates.forEach((update) => {
    lines.push(`// Step ${update.step.step_order}: ${update.step.action || "No action recorded"}`);
    if (update.api_request) {
      lines.push(`// API request: ${JSON.stringify(update.api_request)}`);
    }
    lines.push(update.automation_code || "// API request is stored structurally on the QAira step.");
    lines.push("");
  });

  return lines.join("\n");
};

const persistLearning = async ({ testCase, learnedLocators, capturedActions, capturedNetwork, transactionId }) => {
  let persisted = 0;

  for (const locator of learnedLocators) {
    await upsertLearningCache.run(
      uuid(),
      testCase.project_id || null,
      testCase.app_type_id || null,
      testCase.id,
      locator.page_url,
      locator.page_key,
      locator.locator_intent,
      locator.locator,
      locator.locator_kind,
      locator.confidence,
      "ai_builder",
      {
        ...locator.metadata,
        test_case_title: testCase.title
      }
    );
    persisted += 1;
  }

  for (const action of capturedActions) {
    if (!action.locator) {
      continue;
    }

    await upsertLearningCache.run(
      uuid(),
      testCase.project_id || null,
      testCase.app_type_id || null,
      testCase.id,
      action.url || null,
      normalizeUrlKey(action.url),
      action.text || action.type || "recorded action",
      action.locator,
      "recorder",
      0.72,
      "recorder",
      {
        action_type: action.type,
        value_captured: Boolean(action.value)
      }
    );
    persisted += 1;
  }

  if (capturedNetwork.length) {
    await appendEvent(transactionId, {
      phase: "recorder.network.learned",
      message: `Recorder captured ${capturedNetwork.length} candidate API request${capturedNetwork.length === 1 ? "" : "s"} for API test generation.`,
      details: {
        captured_network_count: capturedNetwork.length,
        sample: capturedNetwork.slice(0, 5)
      }
    });
  }

  return persisted;
};

const applyBuild = async ({ testCase, build, createdBy }) => {
  const updated = [];

  for (const update of build.updates) {
    await testStepService.updateTestStep(update.step.id, {
      step_type: update.step_type,
      automation_code: update.automation_code,
      api_request: update.api_request
    });
    updated.push({
      step_id: update.step.id,
      step_order: update.step.step_order,
      step_type: update.step_type,
      has_code: Boolean(update.automation_code),
      has_api_request: Boolean(update.api_request)
    });
  }

  if (updated.length) {
    await updateCaseAutomated.run(createdBy || null, testCase.id);
  }

  return updated;
};

const buildCaseCore = async ({
  test_case_id,
  integration_id,
  created_by,
  start_url,
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  captured_actions = [],
  captured_network = [],
  additional_context,
  transaction_id
}) => {
  const testCase = await selectCaseWithScope.get(test_case_id);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  if (!["web", "unified"].includes(String(testCase.app_type_kind || "web"))) {
    throw new Error("Automation builder currently supports web and unified app types");
  }

  const steps = await selectStepsForCase.all(test_case_id);

  if (!steps.length) {
    throw new Error("Add manual steps before building automation");
  }

  const cacheRows = await selectLearningCache.all(
    testCase.project_id || null,
    testCase.project_id || null,
    testCase.app_type_id || null,
    testCase.app_type_id || null,
    MAX_CACHE_ROWS
  );
  const capturedActions = normalizeCapturedActions(captured_actions);
  const capturedNetwork = normalizeCapturedNetwork(captured_network);
  const buildContext = await resolveBuildContext({
    testCase,
    test_environment_id,
    test_configuration_id,
    test_data_set_id
  });
  const startUrl = normalizeText(start_url) || buildContext.environment?.base_url || null;
  let integration = null;
  let fallbackReason = null;
  let build = null;

  await appendEvent(transaction_id, {
    phase: "automation.context",
    message: `Packed ${steps.length} manual step${steps.length === 1 ? "" : "s"} with ${cacheRows.length} cached locator learning item${cacheRows.length === 1 ? "" : "s"}.`,
    details: {
      test_case_id,
      step_count: steps.length,
      cache_hits: cacheRows.length,
      captured_actions: capturedActions.length,
      captured_network: capturedNetwork.length,
      test_environment_id: buildContext.environment?.id || null,
      test_configuration_id: buildContext.configuration?.id || null,
      test_data_set_id: buildContext.data_set?.id || null
    }
  });

  try {
    integration = await resolveLlmIntegration(integration_id);
  } catch (error) {
    throw error;
  }

  if (integration) {
    try {
      const prompt = buildPrompt({
        testCase,
        steps,
        cacheRows,
        capturedActions,
        capturedNetwork,
        buildContext,
        startUrl,
        additionalContext: normalizeRichText(additional_context)
      });
      const content = await requestChatCompletion({ integration, prompt });
      build = normalizeLlmBuild(extractJsonPayload(content), steps, cacheRows, startUrl);

      await appendEvent(transaction_id, {
        phase: "automation.llm.completed",
        message: `LLM generated ${build.updates.length} step automation update${build.updates.length === 1 ? "" : "s"}.`,
        details: {
          integration_id: integration.id,
          model: integration.model,
          generated_steps: build.updates.length,
          learned_locators: build.learned_locators.length
        }
      });
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : "LLM generation failed";
      build = buildFallbackBuild(steps, cacheRows, startUrl, fallbackReason);
      await appendEvent(transaction_id, {
        level: "warning",
        phase: "automation.llm.fallback",
        message: "LLM automation generation failed; QAira created deterministic keyword starter automation instead.",
        details: {
          error: fallbackReason
        }
      });
    }
  } else {
    fallbackReason = "No active LLM integration is configured";
    build = buildFallbackBuild(steps, cacheRows, startUrl, fallbackReason);
    await appendEvent(transaction_id, {
      level: "warning",
      phase: "automation.llm.unavailable",
      message: "No active LLM integration is configured; QAira created deterministic keyword starter automation.",
      details: {
        fallback_reason: fallbackReason
      }
    });
  }

  const stepUpdates = await applyBuild({
    testCase,
    build,
    createdBy: created_by
  });
  const learnedCount = await persistLearning({
    testCase,
    learnedLocators: build.learned_locators,
    capturedActions,
    capturedNetwork,
    transactionId: transaction_id
  });
  const artifactContent = createArtifactContent({
    testCase,
    updates: build.updates
  });
  let artifact = null;

  if (transaction_id) {
    artifact = await workspaceTransactionService.createTransactionArtifact(transaction_id, {
      file_name: `${String(testCase.display_id || testCase.id).replace(/[^A-Za-z0-9_-]+/g, "-")}-automation.spec.js`,
      mime_type: "text/javascript; charset=utf-8",
      content: artifactContent
    });
  }

  await appendEvent(transaction_id, {
    level: stepUpdates.length ? "success" : "warning",
    phase: "automation.case.updated",
    message: stepUpdates.length
      ? `Associated generated automation with "${testCase.title}".`
      : `No step automation was associated with "${testCase.title}".`,
    details: {
      test_case_id,
      updated_steps: stepUpdates.length,
      learned_locator_count: learnedCount,
      artifact_id: artifact?.id || null
    }
  });

  return {
    test_case_id,
    title: testCase.title,
    automated: stepUpdates.length ? "yes" : testCase.automated || "no",
    generated_step_count: stepUpdates.length,
    learned_locator_count: learnedCount,
    cache_hits: cacheRows.length,
    fallback_used: Boolean(fallbackReason),
    fallback_reason: fallbackReason,
    integration: integration
      ? {
          id: integration.id,
          name: integration.name,
          model: integration.model
        }
      : null,
    summary: build.summary,
    artifact_id: artifact?.id || null,
    step_updates: stepUpdates
  };
};

exports.buildAutomationForCase = async ({
  test_case_id,
  integration_id,
  created_by,
  start_url,
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  captured_actions,
  captured_network,
  additional_context,
  transaction_id
} = {}) => {
  const normalizedCaseId = normalizeText(test_case_id);

  if (!normalizedCaseId) {
    throw new Error("test_case_id is required");
  }

  const existingTransactionId = normalizeText(transaction_id);
  const testCase = await selectCaseWithScope.get(normalizedCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  const transaction = existingTransactionId
    ? await workspaceTransactionService.updateTransaction(existingTransactionId, {
        project_id: testCase.project_id || null,
        app_type_id: testCase.app_type_id || null,
        category: "automation_build",
        action: "single_case_automation_build",
        status: "running",
        title: `Automation build for ${testCase.title}`,
        description: "Building step automation from the manual web case.",
        metadata: {
          current_phase: "automation.context",
          progress_percent: 10,
          total_items: 1,
          processed_items: 0,
          test_case_id: normalizedCaseId,
          test_environment_id: normalizeText(test_environment_id),
          test_configuration_id: normalizeText(test_configuration_id),
          test_data_set_id: normalizeText(test_data_set_id)
        },
        started_at: new Date().toISOString()
      })
    : await workspaceTransactionService.createTransaction({
        project_id: testCase.project_id || null,
        app_type_id: testCase.app_type_id || null,
        category: "automation_build",
        action: "single_case_automation_build",
        status: "running",
        title: `Automation build for ${testCase.title}`,
        description: "Building step automation from the manual web case.",
        metadata: {
          current_phase: "automation.context",
          progress_percent: 10,
          total_items: 1,
          processed_items: 0,
          test_case_id: normalizedCaseId,
          test_environment_id: normalizeText(test_environment_id),
          test_configuration_id: normalizeText(test_configuration_id),
          test_data_set_id: normalizeText(test_data_set_id)
        },
        related_kind: "test_case",
        related_id: normalizedCaseId,
        created_by,
        started_at: new Date().toISOString()
      });

  try {
    const result = await buildCaseCore({
      test_case_id: normalizedCaseId,
      integration_id,
      created_by,
      start_url,
      test_environment_id,
      test_configuration_id,
      test_data_set_id,
      captured_actions,
      captured_network,
      additional_context,
      transaction_id: transaction.id
    });

    await workspaceTransactionService.updateTransaction(transaction.id, {
      status: result.generated_step_count ? "completed" : "failed",
      description: result.generated_step_count
        ? `Generated automation for ${result.generated_step_count} step${result.generated_step_count === 1 ? "" : "s"} and associated it with the manual case.`
        : "Automation builder did not produce any step updates.",
      metadata: {
        current_phase: "completed",
        progress_percent: 100,
        total_items: 1,
        processed_items: 1,
        generated_steps: result.generated_step_count,
        learned_locator_count: result.learned_locator_count,
        fallback_used: result.fallback_used,
        artifact_id: result.artifact_id
      },
      completed_at: new Date().toISOString()
    });

    return {
      ...result,
      transaction_id: transaction.id
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automation build failed";
    await workspaceTransactionService.updateTransaction(transaction.id, {
      status: "failed",
      description: message,
      metadata: {
        current_phase: "failed",
        progress_percent: 100,
        error: message
      },
      completed_at: new Date().toISOString()
    });
    await appendEvent(transaction.id, {
      level: "error",
      phase: "automation.failed",
      message,
      details: {
        test_case_id: normalizedCaseId
      }
    });
    throw error;
  }
};

exports.buildAutomationBatch = async ({
  app_type_id,
  test_case_ids = [],
  integration_id,
  created_by,
  start_url,
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  failure_threshold,
  additional_context,
  transaction_id
} = {}) => {
  const appTypeId = normalizeText(app_type_id);

  if (!appTypeId) {
    throw new Error("app_type_id is required");
  }

  const selectedIds = normalizeIdList(test_case_ids);
  const targetIds = selectedIds.length
    ? selectedIds
    : (await selectCasesForBatch.all(appTypeId)).map((row) => row.id);
  const failureThreshold = Math.max(1, Number(failure_threshold) || DEFAULT_BATCH_FAILURE_THRESHOLD);

  if (!targetIds.length) {
    throw new Error("No manual web test cases were found for automation build");
  }

  const firstCase = await selectCaseWithScope.get(targetIds[0]);
  const transactionId = normalizeText(transaction_id);

  if (transactionId) {
    await updateTransaction(transactionId, {
      project_id: firstCase?.project_id || null,
      app_type_id: appTypeId,
      category: "automation_build",
      action: "batch_case_automation_build",
      status: "running",
      title: "Batch web automation build",
      description: `Building automation for ${targetIds.length} manual web case${targetIds.length === 1 ? "" : "s"}.`,
      metadata: {
        current_phase: "queued",
        total_items: targetIds.length,
        processed_items: 0,
        generated: 0,
        failed: 0,
        failure_threshold: failureThreshold,
        progress_percent: 0
      },
      started_at: new Date().toISOString()
    });
  }

  const created = [];
  const errors = [];
  let stoppedByThreshold = false;

  for (const [index, testCaseId] of targetIds.entries()) {
    if (errors.length >= failureThreshold) {
      stoppedByThreshold = true;
      await appendEvent(transactionId, {
        level: "warning",
        phase: "automation.failure_threshold",
        message: `Automation build stopped after ${errors.length} failed case${errors.length === 1 ? "" : "s"}.`,
        details: {
          failure_threshold: failureThreshold,
          remaining_case_count: targetIds.length - index
        }
      });
      break;
    }

    await appendEvent(transactionId, {
      phase: "automation.case.started",
      message: `Building automation for case ${index + 1} of ${targetIds.length}.`,
      details: {
        test_case_id: testCaseId,
        case_index: index + 1,
        total_cases: targetIds.length
      }
    });

    try {
      const result = await buildCaseCore({
        test_case_id: testCaseId,
        integration_id,
        created_by,
        start_url,
        test_environment_id,
        test_configuration_id,
        test_data_set_id,
        additional_context,
        transaction_id: transactionId
      });
      created.push(result);
    } catch (error) {
      errors.push({
        test_case_id: testCaseId,
        message: error instanceof Error ? error.message : "Automation build failed"
      });
      await appendEvent(transactionId, {
        level: "error",
        phase: "automation.case.failed",
        message: `Automation build failed for case ${testCaseId}.`,
        details: errors[errors.length - 1]
      });
    }

    const processed = index + 1;
    await updateTransaction(transactionId, {
      description: `Built automation for ${created.length} of ${targetIds.length} case${targetIds.length === 1 ? "" : "s"} so far.`,
      metadata: {
        current_phase: "automation.build",
        total_items: targetIds.length,
        processed_items: processed,
        generated: created.length,
        failed: errors.length,
        failure_threshold: failureThreshold,
        progress_percent: Math.round((processed / targetIds.length) * 100)
      }
    });
  }

  const processedCount = created.length + errors.length;
  const skippedCount = stoppedByThreshold ? Math.max(0, targetIds.length - processedCount) : 0;

  await updateTransaction(transactionId, {
    status: created.length ? "completed" : "failed",
    description: created.length
      ? `Associated generated automation with ${created.length} manual case${created.length === 1 ? "" : "s"}.`
      : "Batch automation build completed without updating a case.",
    metadata: {
      current_phase: "completed",
      total_items: targetIds.length,
      processed_items: processedCount,
      generated: created.length,
      failed: errors.length,
      skipped: skippedCount,
      failure_threshold: failureThreshold,
      stopped_by_failure_threshold: stoppedByThreshold,
      progress_percent: 100,
      sample_errors: errors.slice(0, 10)
    },
    completed_at: new Date().toISOString()
  });
  await appendEvent(transactionId, {
    level: created.length ? "success" : "error",
    phase: "automation.batch.completed",
    message: `Batch automation build completed with ${created.length} generated, ${errors.length} failed, and ${skippedCount} skipped.`,
    details: {
      generated: created.length,
      failed: errors.length,
      skipped: skippedCount,
      failure_threshold: failureThreshold,
      stopped_by_failure_threshold: stoppedByThreshold,
      sample_errors: errors.slice(0, 10)
    }
  });

  return {
    generated: created.length,
    failed: errors.length,
    skipped: skippedCount,
    created,
    errors
  };
};

exports.listLearningCache = async ({ project_id, app_type_id, limit } = {}) => {
  const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  return selectLearningCache.all(
    normalizeText(project_id),
    normalizeText(project_id),
    normalizeText(app_type_id),
    normalizeText(app_type_id),
    boundedLimit
  );
};

const resolveTestEngineIntegration = async (testCase) => {
  const integration = await integrationService.getActiveIntegrationByTypeForProject("testengine", testCase.project_id);

  if (!integration?.base_url) {
    throw new Error("Configure an active Test Engine integration before starting a local browser recorder session");
  }

  return integration;
};

const readEngineJson = async (url, init = {}) => {
  const response = await fetchWithTimeout(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.headers || {})
    }
  }, ENGINE_TIMEOUT_MS);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || `Test Engine request failed with status ${response.status}`);
  }

  return payload;
};

const buildEngineUrl = (baseUrl, value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).toString();
  } catch {
    return new URL(normalized, `${String(baseUrl || "").replace(/\/+$/, "")}/`).toString();
  }
};

exports.startRecorderSession = async ({
  test_case_id,
  start_url,
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  created_by
} = {}) => {
  const testCaseId = normalizeText(test_case_id);

  if (!testCaseId) {
    throw new Error("test_case_id is required");
  }

  const testCase = await selectCaseWithScope.get(testCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  const steps = await selectStepsForCase.all(testCaseId);
  const buildContext = await resolveBuildContext({
    testCase,
    test_environment_id,
    test_configuration_id,
    test_data_set_id
  });
  const integration = await resolveTestEngineIntegration(testCase);
  const baseUrl = String(integration.base_url || "").replace(/\/+$/, "");
  const resolvedStartUrl = normalizeText(start_url) || buildContext.environment?.base_url || null;
  const session = await readEngineJson(`${baseUrl}/api/v1/recorder/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      start_url: resolvedStartUrl,
      test_case: {
        id: testCase.id,
        title: testCase.title,
        description: testCase.description || "",
        steps: steps.map(summarizeStep)
      }
    })
  });
  const transaction = await workspaceTransactionService.createTransaction({
    project_id: testCase.project_id || null,
    app_type_id: testCase.app_type_id || null,
    category: "automation_build",
    action: "test_case_recorder",
    status: "running",
    title: `Recorder session for ${testCase.title}`,
    description: "A local Test Engine browser recorder session is capturing user actions and API requests.",
    metadata: {
      current_phase: "recorder.running",
      progress_percent: 20,
      test_case_id: testCase.id,
      test_environment_id: buildContext.environment?.id || null,
      test_configuration_id: buildContext.configuration?.id || null,
      test_data_set_id: buildContext.data_set?.id || null,
      recorder_session_id: session.id,
      engine_base_url: baseUrl
    },
    related_kind: "test_case",
    related_id: testCase.id,
    created_by,
    started_at: new Date().toISOString()
  });

  await appendEvent(transaction.id, {
    phase: "recorder.started",
    message: session.live_view_path || session.live_view_url
      ? "Started a browser-backed recorder session with a QAira live view."
      : "Started a local browser recorder session through the active Test Engine.",
    details: {
      recorder_session_id: session.id,
      engine_base_url: baseUrl,
      display_mode: session.display_mode || null,
      live_view_available: Boolean(session.live_view_path || session.live_view_url),
      start_url: resolvedStartUrl,
      test_environment_id: buildContext.environment?.id || null,
      test_configuration_id: buildContext.configuration?.id || null,
      test_data_set_id: buildContext.data_set?.id || null
    }
  });

  return {
    ...session,
    transaction_id: transaction.id,
    engine_base_url: baseUrl,
    live_view_url: buildEngineUrl(baseUrl, session.live_view_url || session.live_view_path),
    status_url: `${baseUrl}/api/v1/recorder/sessions/${session.id}`
  };
};

exports.finishRecorderSession = async ({
  test_case_id,
  recorder_session_id,
  transaction_id,
  integration_id,
  created_by,
  additional_context,
  test_environment_id,
  test_configuration_id,
  test_data_set_id
} = {}) => {
  const testCaseId = normalizeText(test_case_id);
  const sessionId = normalizeText(recorder_session_id);

  if (!testCaseId || !sessionId) {
    throw new Error("test_case_id and recorder_session_id are required");
  }

  const testCase = await selectCaseWithScope.get(testCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  const engineIntegration = await resolveTestEngineIntegration(testCase);
  const baseUrl = String(engineIntegration.base_url || "").replace(/\/+$/, "");
  const session = await readEngineJson(`${baseUrl}/api/v1/recorder/sessions/${sessionId}`);

  await readEngineJson(`${baseUrl}/api/v1/recorder/sessions/${sessionId}/stop`, {
    method: "POST"
  }).catch(() => null);

  const result = await exports.buildAutomationForCase({
    test_case_id: testCaseId,
    integration_id,
    created_by,
    start_url: session.start_url,
    test_environment_id,
    test_configuration_id,
    test_data_set_id,
    captured_actions: session.actions || [],
    captured_network: session.network || [],
    additional_context,
    transaction_id
  });

  return {
    ...result,
    recorder_session: {
      id: session.id,
      action_count: Array.isArray(session.actions) ? session.actions.length : 0,
      network_count: Array.isArray(session.network) ? session.network.length : 0
    }
  };
};
