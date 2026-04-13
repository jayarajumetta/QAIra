const db = require("../db");
const integrationService = require("./integration.service");

const DIRECT_CASE_SUITE_ID = "default";
const DIRECT_CASE_SUITE_NAME = "Default";

const selectTestEnvironment = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, base_url, browser, notes, variables
  FROM test_environments
  WHERE id = ?
`);

const selectTestConfiguration = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, browser, mobile_os, platform_version, variables
  FROM test_configurations
  WHERE id = ?
`);

const selectTestDataSet = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, mode, columns, rows
  FROM test_data_sets
  WHERE id = ?
`);

const selectCasesForPlanning = db.prepare(`
  SELECT id, title, description, priority, status
  FROM test_cases
  WHERE app_type_id = ?
  ORDER BY created_at DESC, title ASC
`);

const selectSuiteMappingsForPlanning = db.prepare(`
  SELECT stc.test_case_id, ts.name AS suite_name
  FROM suite_test_cases stc
  JOIN test_suites ts ON ts.id = stc.suite_id
  WHERE ts.app_type_id = ?
  ORDER BY stc.test_case_id ASC, stc.sort_order ASC, ts.name ASC
`);

const selectRequirementMappingsForPlanning = db.prepare(`
  SELECT rtc.test_case_id, r.title AS requirement_title
  FROM requirement_test_cases rtc
  JOIN requirements r ON r.id = rtc.requirement_id
  JOIN test_cases tc ON tc.id = rtc.test_case_id
  WHERE tc.app_type_id = ?
  ORDER BY rtc.test_case_id ASC, r.title ASC
`);

const selectStepsForPlanning = db.prepare(`
  SELECT test_case_id, step_order, action, expected_result, group_name
  FROM test_steps
  WHERE test_case_id IN (
    SELECT id
    FROM test_cases
    WHERE app_type_id = ?
  )
  ORDER BY test_case_id ASC, step_order ASC, id ASC
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
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

const toCsvCell = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  return `"${raw.replace(/"/g, "\"\"")}"`;
};

const uniqueList = (values = []) => Array.from(new Set(values.filter(Boolean)));

const resolveIntegration = async (integration_id) => {
  const integration = integration_id
    ? await integrationService.getIntegration(integration_id)
    : await integrationService.getActiveIntegrationByType("llm");

  if (!integration) {
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

const requestChatCompletion = async ({ integration, content }) => {
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${integration.api_key}`
    },
    body: JSON.stringify({
      model: integration.model,
      temperature: 0.15,
      messages: [
        {
          role: "system",
          content: "You are a senior QA architect. Return strict JSON only."
        },
        {
          role: "user",
          content
        }
      ]
    })
  });

  if (!response.ok) {
    const raw = await response.text();
    const detail = raw.slice(0, 200).trim();
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

async function resolveExecutionContextResource({ id, label, projectId, appTypeId, lookup, describe }) {
  if (!id) {
    return null;
  }

  const resource = await lookup.get(id);

  if (!resource) {
    throw new Error(`${label} not found`);
  }

  if (resource.project_id !== projectId) {
    throw new Error(`${label} must belong to the selected project`);
  }

  if (resource.app_type_id && resource.app_type_id !== appTypeId) {
    throw new Error(`${label} must belong to the selected app type or be shared at project level`);
  }

  return {
    id: resource.id,
    name: resource.name,
    summary: describe(resource)
  };
}

const summarizeEnvironment = (resource) => {
  return [
    resource.name,
    normalizeText(resource.base_url) ? `Base URL: ${resource.base_url}` : null,
    normalizeText(resource.browser) ? `Browser: ${resource.browser}` : null,
    normalizeText(resource.notes) ? `Notes: ${resource.notes}` : null
  ]
    .filter(Boolean)
    .join(" | ");
};

const summarizeConfiguration = (resource) => {
  const variables = parseJsonValue(resource.variables, []);

  return [
    resource.name,
    normalizeText(resource.browser) ? `Browser: ${resource.browser}` : null,
    normalizeText(resource.mobile_os) ? `Mobile OS: ${resource.mobile_os}` : null,
    normalizeText(resource.platform_version) ? `Platform: ${resource.platform_version}` : null,
    Array.isArray(variables) && variables.length ? `${variables.length} variables` : null
  ]
    .filter(Boolean)
    .join(" | ");
};

const summarizeDataSet = (resource) => {
  const columns = parseJsonValue(resource.columns, []);
  const rows = parseJsonValue(resource.rows, []);

  return [
    resource.name,
    resource.mode ? `Mode: ${resource.mode}` : null,
    Array.isArray(columns) && columns.length ? `${columns.length} columns` : null,
    Array.isArray(rows) ? `${rows.length} rows` : null
  ]
    .filter(Boolean)
    .join(" | ");
};

const buildCaseMaps = ({ cases, suiteMappings, requirementMappings, stepRows }) => {
  const suitesByCaseId = suiteMappings.reduce((accumulator, mapping) => {
    accumulator[mapping.test_case_id] = accumulator[mapping.test_case_id] || [];
    accumulator[mapping.test_case_id].push(mapping.suite_name);
    return accumulator;
  }, {});

  const requirementsByCaseId = requirementMappings.reduce((accumulator, mapping) => {
    accumulator[mapping.test_case_id] = accumulator[mapping.test_case_id] || [];
    accumulator[mapping.test_case_id].push(mapping.requirement_title);
    return accumulator;
  }, {});

  const stepsByCaseId = stepRows.reduce((accumulator, step) => {
    accumulator[step.test_case_id] = accumulator[step.test_case_id] || [];
    accumulator[step.test_case_id].push(step);
    return accumulator;
  }, {});

  return cases.map((testCase) => {
    const steps = stepsByCaseId[testCase.id] || [];
    const suite_names = uniqueList(suitesByCaseId[testCase.id] || []);
    const requirement_titles = uniqueList(requirementsByCaseId[testCase.id] || []);
    const step_summary = steps
      .map((step) => {
        const fragments = [
          Number.isFinite(Number(step.step_order)) ? `${Number(step.step_order)}.` : null,
          normalizeText(step.group_name) ? `[${step.group_name}]` : null,
          normalizeText(step.action) || "No action"
        ].filter(Boolean);
        const expected = normalizeText(step.expected_result);
        return expected ? `${fragments.join(" ")} => ${expected}` : fragments.join(" ");
      })
      .join(" | ");

    return {
      id: testCase.id,
      title: testCase.title,
      description: testCase.description || null,
      priority: testCase.priority ?? null,
      status: testCase.status || null,
      suite_names,
      requirement_titles,
      step_count: steps.length,
      step_summary
    };
  });
};

const buildCaseCsv = (cases = []) => {
  const rows = [
    [
      "test_case_id",
      "title",
      "description",
      "priority",
      "status",
      "suites",
      "requirements",
      "step_count",
      "steps"
    ].map(toCsvCell).join(",")
  ];

  cases.forEach((testCase) => {
    rows.push(
      [
        testCase.id,
        testCase.title,
        testCase.description || "",
        testCase.priority ?? "",
        testCase.status || "",
        testCase.suite_names.join(" | "),
        testCase.requirement_titles.join(" | "),
        testCase.step_count,
        testCase.step_summary
      ].map(toCsvCell).join(",")
    );
  });

  return rows.join("\n");
};

const buildFallbackExecutionName = (releaseScope, appTypeName) => {
  const scopeSnippet = normalizeText(releaseScope)
    ?.split(/\s+/)
    .slice(0, 6)
    .join(" ");

  return scopeSnippet ? `${appTypeName} Impact - ${scopeSnippet}` : `${appTypeName} Impact Execution`;
};

const buildPrompt = ({
  appType,
  releaseScope,
  additionalContext,
  executionContext,
  sourceCaseCount,
  caseCsv
}) => {
  const prompt = [
    "Plan a smart QA execution for a release by selecting impacted existing test cases from the provided CSV library.",
    "",
    `Application type: ${appType.name} (${appType.type})`,
    `Execution suite to use when creating the run: ${DIRECT_CASE_SUITE_NAME} (${DIRECT_CASE_SUITE_ID})`,
    "",
    "Release scope:",
    releaseScope
  ];

  if (additionalContext) {
    prompt.push("");
    prompt.push("Additional release/testing context:");
    prompt.push(additionalContext);
  }

  if (executionContext.length) {
    prompt.push("");
    prompt.push("Selected execution context snapshots:");
    executionContext.forEach((line) => {
      prompt.push(`- ${line}`);
    });
  }

  prompt.push("");
  prompt.push(`Existing test case library CSV (${sourceCaseCount} cases):`);
  prompt.push("```csv");
  prompt.push(caseCsv);
  prompt.push("```");
  prompt.push("");
  prompt.push("Return strict JSON with this exact shape:");
  prompt.push("{");
  prompt.push('  "execution_name": "string",');
  prompt.push('  "summary": "string",');
  prompt.push('  "cases": [');
  prompt.push("    {");
  prompt.push('      "test_case_id": "exact id from CSV",');
  prompt.push('      "reason": "string",');
  prompt.push('      "impact_level": "critical"');
  prompt.push("    }");
  prompt.push("  ]");
  prompt.push("}");
  prompt.push("");
  prompt.push("Rules:");
  prompt.push("- Use only exact test_case_id values that exist in the CSV.");
  prompt.push("- Include every materially impacted case that should be executed for confidence in this release.");
  prompt.push("- Exclude obviously unrelated cases.");
  prompt.push("- Use the reason field to explain why the case belongs in this execution.");
  prompt.push("- impact_level must be one of: critical, high, medium, low.");
  prompt.push("- If nothing is materially impacted, return an empty cases array and explain why in summary.");
  prompt.push("- Do not include markdown or commentary outside the JSON.");

  return prompt.join("\n");
};

const normalizeImpactLevel = (value) => {
  const normalized = normalizeText(value)?.toLowerCase();

  if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }

  return "medium";
};

exports.previewSmartExecution = async ({
  project_id,
  appType,
  integration_id,
  release_scope,
  additional_context,
  test_environment_id,
  test_configuration_id,
  test_data_set_id
}) => {
  const releaseScope = normalizeText(release_scope);
  const additionalContext = normalizeText(additional_context);

  if (!project_id || !appType?.id || !releaseScope) {
    throw new Error("Project, app type, and release scope are required");
  }

  const [selectedEnvironment, selectedConfiguration, selectedDataSet, cases, suiteMappings, requirementMappings, stepRows, integration] =
    await Promise.all([
      resolveExecutionContextResource({
        id: test_environment_id,
        label: "Test environment",
        projectId: project_id,
        appTypeId: appType.id,
        lookup: selectTestEnvironment,
        describe: summarizeEnvironment
      }),
      resolveExecutionContextResource({
        id: test_configuration_id,
        label: "Test configuration",
        projectId: project_id,
        appTypeId: appType.id,
        lookup: selectTestConfiguration,
        describe: summarizeConfiguration
      }),
      resolveExecutionContextResource({
        id: test_data_set_id,
        label: "Test data set",
        projectId: project_id,
        appTypeId: appType.id,
        lookup: selectTestDataSet,
        describe: summarizeDataSet
      }),
      selectCasesForPlanning.all(appType.id),
      selectSuiteMappingsForPlanning.all(appType.id),
      selectRequirementMappingsForPlanning.all(appType.id),
      selectStepsForPlanning.all(appType.id),
      resolveIntegration(integration_id)
    ]);

  if (!cases.length) {
    throw new Error("No existing test cases are available in this app type yet");
  }

  const scopedCases = buildCaseMaps({
    cases,
    suiteMappings,
    requirementMappings,
    stepRows
  });
  const caseMap = new Map(scopedCases.map((testCase) => [testCase.id, testCase]));
  const caseCsv = buildCaseCsv(scopedCases);
  const executionContext = [
    selectedEnvironment ? `Environment: ${selectedEnvironment.summary}` : null,
    selectedConfiguration ? `Configuration: ${selectedConfiguration.summary}` : null,
    selectedDataSet ? `Data set: ${selectedDataSet.summary}` : null
  ].filter(Boolean);
  const prompt = buildPrompt({
    appType,
    releaseScope,
    additionalContext,
    executionContext,
    sourceCaseCount: scopedCases.length,
    caseCsv
  });

  const content = await requestChatCompletion({ integration, content: prompt });
  const payload = extractJsonPayload(content);
  const rawCases = Array.isArray(payload?.cases)
    ? payload.cases
    : Array.isArray(payload?.test_cases)
      ? payload.test_cases
      : Array.isArray(payload?.testCases)
        ? payload.testCases
        : [];

  const normalizedCases = uniqueList(
    rawCases
      .map((item) => {
        const testCaseId = normalizeText(item?.test_case_id || item?.testCaseId || item?.id);

        if (!testCaseId || !caseMap.has(testCaseId)) {
          return null;
        }

        const match = caseMap.get(testCaseId);

        return {
          test_case_id: match.id,
          title: match.title,
          description: match.description,
          priority: match.priority,
          status: match.status,
          suite_names: match.suite_names,
          requirement_titles: match.requirement_titles,
          step_count: match.step_count,
          reason: normalizeText(item?.reason) || "Selected as impacted by the release scope.",
          impact_level: normalizeImpactLevel(item?.impact_level || item?.impactLevel)
        };
      })
      .filter(Boolean)
      .map((item) => item.test_case_id)
  ).map((test_case_id) => {
    const raw = rawCases.find((item) => {
      const candidateId = normalizeText(item?.test_case_id || item?.testCaseId || item?.id);
      return candidateId === test_case_id;
    });
    const match = caseMap.get(test_case_id);

    return {
      test_case_id: match.id,
      title: match.title,
      description: match.description,
      priority: match.priority,
      status: match.status,
      suite_names: match.suite_names,
      requirement_titles: match.requirement_titles,
      step_count: match.step_count,
      reason: normalizeText(raw?.reason) || "Selected as impacted by the release scope.",
      impact_level: normalizeImpactLevel(raw?.impact_level || raw?.impactLevel)
    };
  });

  if (rawCases.length && !normalizedCases.length) {
    throw new Error("AI could not match impacted cases to the existing library. Refine the release scope and try again.");
  }

  return {
    integration: {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      model: integration.model
    },
    app_type: {
      id: appType.id,
      name: appType.name
    },
    default_suite: {
      id: DIRECT_CASE_SUITE_ID,
      name: DIRECT_CASE_SUITE_NAME
    },
    source_case_count: scopedCases.length,
    matched_case_count: normalizedCases.length,
    execution_name:
      normalizeText(payload?.execution_name || payload?.executionName) ||
      buildFallbackExecutionName(releaseScope, appType.name),
    summary:
      normalizeText(payload?.summary) ||
      (normalizedCases.length
        ? `${normalizedCases.length} impacted test case${normalizedCases.length === 1 ? "" : "s"} selected from ${scopedCases.length} existing cases.`
        : "No materially impacted test cases were identified for this release scope."),
    cases: normalizedCases
  };
};
