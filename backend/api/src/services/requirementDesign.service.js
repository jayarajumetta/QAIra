const integrationService = require("./integration.service");
const testCaseService = require("./testCase.service");

const DEFAULT_CASE_LIMIT = 8;

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

const normalizeSteps = (steps = []) => {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps
    .map((step, index) => ({
      step_order: Number.isFinite(Number(step?.step_order)) ? Number(step.step_order) : index + 1,
      action: normalizeText(step?.action),
      expected_result: normalizeText(step?.expected_result || step?.expectedResult)
    }))
    .filter((step) => step.action || step.expected_result)
    .map((step, index) => ({
      ...step,
      step_order: index + 1
    }));
};

const normalizeCaseDraft = (item, index) => {
  const title = normalizeText(item?.title);

  if (!title) {
    throw new Error(`Generated test case ${index + 1} is missing a title`);
  }

  return {
    title,
    description: normalizeText(item?.description),
    priority: Number.isFinite(Number(item?.priority)) ? Number(item.priority) : 3,
    steps: normalizeSteps(item?.steps)
  };
};

const normalizeGeneratedCases = (payload, maxCases) => {
  const collection = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.testCases)
      ? payload.testCases
      : Array.isArray(payload?.test_cases)
        ? payload.test_cases
        : [];

  if (!collection.length) {
    throw new Error("LLM did not return any test cases");
  }

  return collection.slice(0, maxCases).map((item, index) => normalizeCaseDraft(item, index));
};

const buildPrompt = ({ requirement, appType, maxCases }) => {
  return [
    "Design high-quality QA test cases for the following requirement.",
    "",
    `Project requirement title: ${requirement.title}`,
    `Project requirement description: ${requirement.description || "No description provided."}`,
    `Application type: ${appType.name} (${appType.type})`,
    "",
    `Return up to ${maxCases} test cases as strict JSON with this shape:`,
    "{",
    '  "testCases": [',
    "    {",
    '      "title": "string",',
    '      "description": "string",',
    '      "priority": 1,',
    '      "steps": [',
    "        {",
    '          "action": "string",',
    '          "expected_result": "string"',
    "        }",
    "      ]",
    "    }",
    "  ]",
    "}",
    "",
    "Guidance:",
    "- Cover happy path, validation, edge conditions, negative conditions, and operational risk where relevant.",
    "- Keep titles concise and reusable across suites.",
    "- Use 1-5 priority where 1 is most critical.",
    "- Do not include markdown or commentary outside the JSON."
  ].join("\n");
};

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

const requestGeneratedCases = async ({ integration, requirement, appType, maxCases }) => {
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${integration.api_key}`
    },
    body: JSON.stringify({
      model: integration.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You are a senior QA architect. Return strict JSON only."
        },
        {
          role: "user",
          content: buildPrompt({ requirement, appType, maxCases })
        }
      ]
    })
  });

  if (!response.ok) {
    const raw = await response.text();
    const detail = raw.slice(0, 200).trim();
    throw new Error(`LLM request failed with status ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("LLM response did not include generated content");
  }

  return normalizeGeneratedCases(extractJsonPayload(content), maxCases);
};

const normalizeAcceptedCases = (cases = []) => {
  if (!Array.isArray(cases) || !cases.length) {
    throw new Error("At least one generated test case is required");
  }

  return cases.map((item, index) => normalizeCaseDraft(item, index));
};

exports.previewRequirementTestCases = async ({
  requirement,
  appType,
  integration_id,
  max_cases
}) => {
  const maxCases = Number.isFinite(Number(max_cases))
    ? Math.max(1, Math.min(Number(max_cases), 20))
    : DEFAULT_CASE_LIMIT;
  const integration = await resolveIntegration(integration_id);
  const generatedCases = await requestGeneratedCases({
    integration,
    requirement,
    appType,
    maxCases
  });

  return {
    integration: {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      model: integration.model
    },
    requirement: {
      id: requirement.id,
      title: requirement.title
    },
    app_type: {
      id: appType.id,
      name: appType.name
    },
    generated: generatedCases.length,
    cases: generatedCases.map((candidate, index) => ({
      ...candidate,
      client_id: `draft-${index + 1}`,
      step_count: candidate.steps.length
    }))
  };
};

exports.acceptRequirementTestCases = async ({
  requirement,
  appType,
  status = "draft",
  cases = []
}) => {
  const acceptedCases = normalizeAcceptedCases(cases);
  const created = [];

  for (const candidate of acceptedCases) {
    const response = await testCaseService.createTestCase({
      app_type_id: appType.id,
      title: candidate.title,
      description: candidate.description || undefined,
      priority: candidate.priority,
      status,
      requirement_ids: [requirement.id],
      steps: candidate.steps
    });

    created.push({
      id: response.id,
      title: candidate.title,
      step_count: candidate.steps.length
    });
  }

  return {
    accepted: created.length,
    created
  };
};

exports.generateRequirementTestCases = async ({
  requirement,
  appType,
  integration_id,
  max_cases,
  status = "draft"
}) => {
  const preview = await exports.previewRequirementTestCases({
    requirement,
    appType,
    integration_id,
    max_cases
  });

  const accepted = await exports.acceptRequirementTestCases({
    requirement,
    appType,
    status,
    cases: preview.cases
  });

  return {
    integration: preview.integration,
    generated: accepted.accepted,
    created: accepted.created
  };
};
