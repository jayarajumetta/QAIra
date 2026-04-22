const { URL } = require("url");
const db = require("../db");
const { v4: uuid } = require("uuid");
const workspaceTransactionService = require("./workspaceTransaction.service");
const {
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType
} = require("../utils/testStepAutomation");

const SUPPORTED_ENGINE_STEP_TYPES = new Set(["web", "api"]);
const DISPATCH_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.TESTENGINE_DISPATCH_CONCURRENCY || 4)));

const selectProject = db.prepare(`
  SELECT id, name, display_id
  FROM projects
  WHERE id = ?
`);

const selectAppType = db.prepare(`
  SELECT id, name, type
  FROM app_types
  WHERE id = ?
`);

const selectTestCaseDispatchMetadata = db.prepare(`
  SELECT id, title, display_id, automated
  FROM test_cases
  WHERE id = ?
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeStringRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [key, entry]) => {
    const normalizedKey = normalizeText(String(key || "").replace(/^@+/, ""))?.toLowerCase();

    if (!normalizedKey) {
      return accumulator;
    }

    accumulator[normalizedKey] = entry === undefined || entry === null ? "" : String(entry);
    return accumulator;
  }, {});
};

const toEngineKeyValueEntries = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => ({
      key: normalizeText(entry?.key),
      value: entry?.value === undefined || entry?.value === null ? "" : String(entry.value),
      is_secret: Boolean(entry?.is_secret)
    }))
    .filter((entry) => entry.key);
};

const toEngineDataSetRows = (rows) => {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) =>
      Object.entries(row).reduce((accumulator, [key, value]) => {
        const normalizedKey = normalizeText(String(key || ""));

        if (!normalizedKey) {
          return accumulator;
        }

        accumulator[normalizedKey] = value === undefined || value === null ? "" : String(value);
        return accumulator;
      }, {})
    );
};

const resolveEngineStepType = (stepType, appTypeKind) => {
  const normalized = normalizeTestStepType(stepType, null);

  if (normalized && SUPPORTED_ENGINE_STEP_TYPES.has(normalized)) {
    return normalized;
  }

  if (normalized === "android" || normalized === "ios") {
    return null;
  }

  if (appTypeKind === "api") {
    return "api";
  }

  return "web";
};

const buildRunEndpoint = (baseUrl) => {
  const normalizedBaseUrl = normalizeText(baseUrl);

  if (!normalizedBaseUrl) {
    throw new Error("The active Test Engine integration is missing a host URL");
  }

  const root = normalizedBaseUrl.endsWith("/") ? normalizedBaseUrl : `${normalizedBaseUrl}/`;
  return new URL("api/v1/runs", root).toString();
};

const buildManualSpec = ({ caseSnapshot, steps, execution }) => {
  const preconditions = [];
  const environmentName = execution.test_environment?.name;
  const environmentBaseUrl = execution.test_environment?.snapshot?.base_url;
  const suiteName = normalizeText(caseSnapshot.suite_name);

  if (suiteName && suiteName !== "Default") {
    preconditions.push(`Scope suite: ${suiteName}`);
  }

  if (environmentName) {
    preconditions.push(
      environmentBaseUrl
        ? `Environment: ${environmentName} (${environmentBaseUrl})`
        : `Environment: ${environmentName}`
    );
  }

  return {
    title: caseSnapshot.test_case_title,
    intent: normalizeText(caseSnapshot.test_case_description) || `Execute and validate ${caseSnapshot.test_case_title}`,
    preconditions,
    steps: steps.map((step) => step.action || `Step ${step.order}`),
    assertions: steps.map((step) => step.expected_result).filter(Boolean),
    test_data: {
      ...normalizeStringRecord(caseSnapshot.suite_parameter_values),
      ...normalizeStringRecord(caseSnapshot.parameter_values)
    },
    environment_notes: normalizeText(execution.test_environment?.snapshot?.notes)
  };
};

const buildEngineEnvelope = ({
  engineRunId,
  integration,
  execution,
  project,
  appType,
  caseSnapshot,
  steps
}) => ({
  engine_run_id: engineRunId,
  qaira_run_id: execution.id,
  qaira_execution_id: execution.id,
  qaira_test_case_id: caseSnapshot.test_case_id,
  qaira_test_case_title: caseSnapshot.test_case_title,
  project: {
    id: project.id,
    name: project.name
  },
  app_type: {
    id: appType?.id || execution.app_type_id || "unknown",
    name: appType?.name || "Unknown App Type",
    kind: appType?.type || "web"
  },
  trigger: "execution",
  source_mode: "manual-handover",
  automated: true,
  browser: integration.config?.browser || "chromium",
  headless: integration.config?.headless !== false,
  max_repair_attempts: Number(integration.config?.max_repair_attempts) || 2,
  run_timeout_seconds: Number(integration.config?.run_timeout_seconds) || 1800,
  manual_spec: buildManualSpec({ caseSnapshot, steps, execution }),
  steps,
  suite_parameters: normalizeStringRecord(caseSnapshot.suite_parameter_values),
  case_parameters: normalizeStringRecord(caseSnapshot.parameter_values),
  environment: execution.test_environment
    ? {
        name: execution.test_environment.name,
        base_url: execution.test_environment.snapshot?.base_url || null,
        browser: execution.test_environment.snapshot?.browser || null,
        variables: toEngineKeyValueEntries(execution.test_environment.snapshot?.variables)
      }
    : null,
  configuration: execution.test_configuration
    ? {
        name: execution.test_configuration.name,
        browser: execution.test_configuration.snapshot?.browser || null,
        mobile_os: execution.test_configuration.snapshot?.mobile_os || null,
        platform_version: execution.test_configuration.snapshot?.platform_version || null,
        variables: toEngineKeyValueEntries(execution.test_configuration.snapshot?.variables)
      }
    : null,
  data_set: execution.test_data_set
    ? {
        name: execution.test_data_set.name,
        mode: execution.test_data_set.snapshot?.mode === "key_value" ? "key_value" : "table",
        columns: Array.isArray(execution.test_data_set.snapshot?.columns)
          ? execution.test_data_set.snapshot.columns.map((entry) => String(entry))
          : [],
        rows: toEngineDataSetRows(execution.test_data_set.snapshot?.rows)
      }
    : null,
  artifact_policy: {
    trace_mode: integration.config?.trace_mode || "on-first-retry",
    video_mode: integration.config?.video_mode || "retain-on-failure",
    screenshot_on_failure: true,
    capture_console: integration.config?.capture_console !== false,
    capture_network: integration.config?.capture_network !== false,
    artifact_retention_days: Number(integration.config?.artifact_retention_days) || 14
  },
  callback: {
    url: integration.config?.callback_url,
    signing_secret: integration.config?.callback_secret
  }
});

const summarizeWarnings = (warnings) => {
  if (!Array.isArray(warnings) || !warnings.length) {
    return [];
  }

  return warnings.map((warning) => String(warning)).filter(Boolean);
};

async function planExecutionDispatch(execution) {
  const [project, appType] = await Promise.all([
    selectProject.get(execution.project_id),
    execution.app_type_id ? selectAppType.get(execution.app_type_id) : Promise.resolve(null)
  ]);

  if (!project) {
    throw new Error("Execution project not found");
  }

  const stepsByCaseId = new Map();

  for (const stepSnapshot of execution.step_snapshots || []) {
    const current = stepsByCaseId.get(stepSnapshot.test_case_id) || [];
    current.push(stepSnapshot);
    stepsByCaseId.set(stepSnapshot.test_case_id, current);
  }

  const warnings = [];
  const eligibleCases = [];
  let automatedCaseCount = 0;
  let manualCaseCount = 0;
  let unsupportedAutomatedCaseCount = 0;

  for (const caseSnapshot of execution.case_snapshots || []) {
    const caseRecord = await selectTestCaseDispatchMetadata.get(caseSnapshot.test_case_id);

    if (caseRecord?.automated !== "yes") {
      manualCaseCount += 1;
      continue;
    }

    automatedCaseCount += 1;

    const rawSteps = stepsByCaseId.get(caseSnapshot.test_case_id) || [];

    if (!rawSteps.length) {
      unsupportedAutomatedCaseCount += 1;
      warnings.push(`${caseSnapshot.test_case_title}: automated case has no snapped steps to hand off.`);
      continue;
    }

    const stepWarnings = [];
    const normalizedSteps = rawSteps.map((stepSnapshot) => {
      const stepType = resolveEngineStepType(stepSnapshot.step_type, appType?.type || null);

      if (!stepType) {
        stepWarnings.push(
          `${caseSnapshot.test_case_title}: step ${stepSnapshot.step_order} uses ${stepSnapshot.step_type || "an unsupported type"} and stays manual.`
        );
        return null;
      }

      return {
        id: stepSnapshot.snapshot_step_id,
        order: stepSnapshot.step_order,
        step_type: stepType,
        action: normalizeText(stepSnapshot.action),
        expected_result: normalizeText(stepSnapshot.expected_result),
        automation_code: normalizeRichText(stepSnapshot.automation_code),
        api_request: stepType === "api" ? normalizeApiRequest(stepSnapshot.api_request) : null,
        group_name: normalizeText(stepSnapshot.group_name),
        group_kind: stepSnapshot.group_kind === "local" || stepSnapshot.group_kind === "reusable"
          ? stepSnapshot.group_kind
          : null
      };
    }).filter(Boolean);

    if (stepWarnings.length) {
      unsupportedAutomatedCaseCount += 1;
      warnings.push(...stepWarnings);
      continue;
    }

    const engineRunId = uuid();
    eligibleCases.push({
      engine_run_id: engineRunId,
      case_snapshot: caseSnapshot,
      case_record: caseRecord,
      envelope: null,
      steps: normalizedSteps
    });
  }

  return {
    execution,
    project,
    appType,
    automated_case_count: automatedCaseCount,
    eligible_automated_case_count: eligibleCases.length,
    manual_case_count: manualCaseCount,
    unsupported_automated_case_count: unsupportedAutomatedCaseCount,
    warnings: summarizeWarnings(warnings),
    eligibleCases
  };
}

async function queueExecutionDispatch({ plan, integration, initiatedBy }) {
  if (!plan.eligibleCases.length) {
    return {
      automated_case_count: plan.automated_case_count,
      queued_for_engine_count: 0,
      manual_case_count: plan.manual_case_count,
      unsupported_automated_case_count: plan.unsupported_automated_case_count,
      warnings: plan.warnings
    };
  }

  const queuedItems = [];

  for (const item of plan.eligibleCases) {
    const envelope = buildEngineEnvelope({
      engineRunId: item.engine_run_id,
      integration,
      execution: plan.execution,
      project: plan.project,
      appType: plan.appType,
      caseSnapshot: item.case_snapshot,
      steps: item.steps
    });

    const transaction = await workspaceTransactionService.createTransaction({
      project_id: plan.execution.project_id,
      app_type_id: plan.execution.app_type_id || null,
      category: "automation",
      action: "testengine_run",
      status: "queued",
      title: `Automated handoff for ${item.case_snapshot.test_case_title}`,
      description: "Queued for Test Engine dispatch.",
      metadata: {
        source: "qaira",
        engine_run_id: item.engine_run_id,
        execution_id: plan.execution.id,
        test_case_id: item.case_snapshot.test_case_id,
        engine_host: integration.base_url || null,
        source_mode: envelope.source_mode
      },
      related_kind: "testengine_run",
      related_id: item.engine_run_id,
      created_by: initiatedBy || plan.execution.created_by || null,
      started_at: new Date().toISOString()
    });

    await workspaceTransactionService.appendTransactionEvent(transaction.id, {
      level: "info",
      phase: "dispatch.queued",
      message: `Queued ${item.case_snapshot.test_case_title} for Test Engine dispatch.`,
      details: {
        execution_id: plan.execution.id,
        test_case_id: item.case_snapshot.test_case_id,
        engine_run_id: item.engine_run_id
      }
    });

    queuedItems.push({
      transaction_id: transaction.id,
      engine_run_id: item.engine_run_id,
      case_snapshot: item.case_snapshot,
      envelope
    });
  }

  queueBackgroundDispatch({
    queuedItems,
    integration
  });

  return {
    automated_case_count: plan.automated_case_count,
    queued_for_engine_count: queuedItems.length,
    manual_case_count: plan.manual_case_count,
    unsupported_automated_case_count: plan.unsupported_automated_case_count,
    warnings: plan.warnings
  };
}

async function runWithConcurrency(items, limit, handler) {
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await handler(items[currentIndex]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
}

async function dispatchQueuedItem({ queuedItem, integration, endpoint }) {
  const headers = {
    "content-type": "application/json",
    "x-qaira-source": "qaira"
  };

  if (integration.api_key) {
    headers.authorization = `Bearer ${integration.api_key}`;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(queuedItem.envelope)
    });

    const contentType = response.headers.get("content-type") || "";
    const rawBody = await response.text();
    const payload = contentType.includes("application/json") && rawBody
      ? JSON.parse(rawBody)
      : {};

    if (!response.ok) {
      throw new Error(payload.message || `Test Engine returned status ${response.status}`);
    }

    const engineState = normalizeText(payload.state) || "queued";
    const transactionStatus = engineState === "running" || engineState === "building-script" || engineState === "healing"
      ? "running"
      : "queued";

    await workspaceTransactionService.appendTransactionEvent(queuedItem.transaction_id, {
      level: "success",
      phase: "run.accepted",
      message: normalizeText(payload.summary) || `Test Engine accepted ${queuedItem.case_snapshot.test_case_title}.`,
      details: {
        execution_id: queuedItem.envelope.qaira_execution_id,
        test_case_id: queuedItem.case_snapshot.test_case_id,
        engine_run_id: queuedItem.engine_run_id,
        engine_state: engineState
      },
      status: transactionStatus,
      metadata: {
        engine_state: engineState
      }
    });
  } catch (error) {
    await workspaceTransactionService.appendTransactionEvent(queuedItem.transaction_id, {
      level: "error",
      phase: "dispatch.failed",
      message: error instanceof Error ? error.message : "Test Engine dispatch failed.",
      details: {
        execution_id: queuedItem.envelope.qaira_execution_id,
        test_case_id: queuedItem.case_snapshot.test_case_id,
        engine_run_id: queuedItem.engine_run_id
      },
      status: "failed"
    });

    await workspaceTransactionService.updateTransaction(queuedItem.transaction_id, {
      status: "failed",
      description: error instanceof Error ? error.message : "Test Engine dispatch failed.",
      completed_at: new Date().toISOString()
    });
  }
}

function queueBackgroundDispatch({ queuedItems, integration }) {
  if (!queuedItems.length) {
    return;
  }

  setImmediate(() => {
    void (async () => {
      const endpoint = buildRunEndpoint(integration.base_url);

      await runWithConcurrency(queuedItems, DISPATCH_CONCURRENCY, async (queuedItem) => {
        await dispatchQueuedItem({
          queuedItem,
          integration,
          endpoint
        });
      });
    })().catch((error) => {
      console.error("Test Engine dispatch queue failed", error);
    });
  });
}

exports.planExecutionDispatch = planExecutionDispatch;
exports.queueExecutionDispatch = queueExecutionDispatch;
