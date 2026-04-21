import type { SharedStepGroupStep, StepApiRequest, StepApiResponseCapture, StepApiValidation, TestStep, TestStepType } from "../types";

export const STEP_TYPE_OPTIONS: Array<{ value: TestStepType; label: string; shortLabel: string }> = [
  { value: "web", label: "Web", shortLabel: "WEB" },
  { value: "api", label: "API", shortLabel: "API" },
  { value: "android", label: "Android", shortLabel: "AND" },
  { value: "ios", label: "iOS", shortLabel: "IOS" }
];

type StepAutomationLike = Partial<Pick<TestStep, "step_order">> &
  Pick<TestStep, "action" | "expected_result" | "step_type" | "automation_code" | "api_request">;

const STEP_TYPE_SET = new Set<TestStepType>(["web", "api", "android", "ios"]);
const API_METHOD_SET = new Set<NonNullable<StepApiRequest["method"]>>(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const API_BODY_MODE_SET = new Set<NonNullable<StepApiRequest["body_mode"]>>(["none", "json", "text", "xml", "form"]);

const normalizeText = (value?: string | null) => {
  const normalized = String(value || "").trim();
  return normalized || "";
};

const normalizeRichText = (value?: string | null) => {
  const normalized = String(value || "").replace(/\r\n/g, "\n");
  return normalized.trim() ? normalized : "";
};

export function normalizeStepType(value?: string | null, fallback: TestStepType = "web"): TestStepType {
  const normalized = String(value || "").trim().toLowerCase() as TestStepType;
  return STEP_TYPE_SET.has(normalized) ? normalized : fallback;
}

export function createEmptyApiRequest(): StepApiRequest {
  return {
    method: "GET",
    url: "",
    headers: [],
    body_mode: "none",
    body: "",
    validations: [{ kind: "status", target: "", expected: "200" }],
    captures: []
  };
}

export function normalizeApiRequest(value?: StepApiRequest | null): StepApiRequest | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const method = String(value.method || "GET").trim().toUpperCase() as NonNullable<StepApiRequest["method"]>;
  const url = normalizeRichText(value.url);
  const bodyMode = String(value.body_mode || "none").trim().toLowerCase() as NonNullable<StepApiRequest["body_mode"]>;
  const body = normalizeRichText(value.body);
  const headers = Array.isArray(value.headers)
    ? value.headers
        .map((header) => ({
          key: normalizeText(header?.key),
          value: normalizeRichText(header?.value)
        }))
        .filter((header) => header.key || header.value)
    : [];
  const validations = Array.isArray(value.validations)
    ? value.validations
        .map((validation) => ({
          kind: normalizeValidationKind(validation?.kind),
          target: normalizeRichText(validation?.target),
          expected: normalizeRichText(validation?.expected)
        }))
        .filter((validation) => validation.kind === "status" || validation.target || validation.expected)
    : [];
  const captures = Array.isArray(value.captures)
    ? value.captures
        .map((capture) => ({
          path: normalizeRichText(capture?.path),
          parameter: normalizeRichText(capture?.parameter)
        }))
        .filter((capture) => capture.path && capture.parameter)
    : [];

  if (!url && !headers.length && !body && !validations.length && !captures.length) {
    return null;
  }

  return {
    method: API_METHOD_SET.has(method) ? method : "GET",
    url,
    headers,
    body_mode: API_BODY_MODE_SET.has(bodyMode) ? bodyMode : "none",
    body,
    validations,
    captures
  };
}

export function ensureApiRequest(value?: StepApiRequest | null): StepApiRequest {
  return normalizeApiRequest(value) || createEmptyApiRequest();
}

export function normalizeAutomationCode(value?: string | null) {
  return normalizeRichText(value);
}

export function stepHasAutomation(step: StepAutomationLike | SharedStepGroupStep) {
  return Boolean(normalizeRichText(step.automation_code) || normalizeApiRequest(step.api_request));
}

function quoteJsString(value: string) {
  return JSON.stringify(value);
}

function indentBlock(value: string, depth = 2) {
  const indentation = " ".repeat(depth);
  return value
    .split("\n")
    .map((line) => (line ? `${indentation}${line}` : line))
    .join("\n");
}

function normalizeValidationKind(value?: string | null): StepApiValidation["kind"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "header" || normalized === "body_contains" || normalized === "json_path") {
    return normalized;
  }
  return "status";
}

function toJsAssertionLiteral(value?: string | null) {
  const normalized = normalizeRichText(value);

  if (!normalized) {
    return quoteJsString("");
  }

  if (normalized === "true" || normalized === "false" || normalized === "null") {
    return normalized;
  }

  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    return normalized;
  }

  if (/^[\[{"]/.test(normalized)) {
    try {
      return JSON.stringify(JSON.parse(normalized));
    } catch {
      return quoteJsString(normalized);
    }
  }

  return quoteJsString(normalized);
}

export function buildApiValidationAssertionCode(validation: StepApiValidation, responseVar: string) {
  const target = normalizeRichText(validation.target);
  const expected = normalizeRichText(validation.expected);

  switch (normalizeValidationKind(validation.kind)) {
    case "header":
      return `expect(${responseVar}.headers[${quoteJsString(target || "content-type")}]).toBe(${quoteJsString(expected || "")});`;
    case "body_contains":
      return `expect(String(${responseVar}.body)).toContain(${quoteJsString(expected || "")});`;
    case "json_path":
      return `expect(readJsonPath(${responseVar}.body, ${quoteJsString(target || "$")})).toEqual(${toJsAssertionLiteral(expected)});`;
    case "status":
    default:
      return `expect(${responseVar}.status).toBe(${Number(expected) || 200});`;
  }
}

function buildApiRequestLiteral(request: StepApiRequest) {
  const headerLines = (request.headers || []).map((header) => `${quoteJsString(header.key)}: ${quoteJsString(header.value)}`);
  const lines = [
    `method: ${quoteJsString(String(request.method || "GET"))},`,
    `url: ${quoteJsString(request.url || "")},`
  ];

  if (headerLines.length) {
    lines.push("headers: {");
    lines.push(...headerLines.map((line) => `  ${line},`));
    lines.push("},");
  }

  if ((request.body_mode || "none") !== "none" && normalizeRichText(request.body)) {
    lines.push(`bodyMode: ${quoteJsString(String(request.body_mode || "text"))},`);
    lines.push(`body: ${quoteJsString(request.body || "")},`);
  }

  return `{\n${indentBlock(lines.join("\n"), 2)}\n}`;
}

function buildApiResponseCaptureCode(capture: StepApiResponseCapture, responseVar: string, index: number) {
  const path = normalizeRichText(capture.path) || "$";
  const parameter = normalizeRichText(capture.parameter) || `@t.capture_${index + 1}`;
  const captureVar = `capture${index + 1}_${parameter.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+/, "") || "value"}`;

  return [
    `const ${captureVar} = readJsonPath(${responseVar}.body, ${quoteJsString(path)});`,
    `// Store ${captureVar} as ${parameter} for downstream steps.`
  ].join("\n");
}

function buildGeneratedApiCode(step: StepAutomationLike, request: StepApiRequest) {
  const stepLabel = `Step ${step.step_order || 1}`;
  const responseVar = `response${step.step_order || 1}`;
  const validationLines = (request.validations || []).map((validation) => buildApiValidationAssertionCode(validation, responseVar));
  const captureLines = (request.captures || []).flatMap((capture, index) => buildApiResponseCaptureCode(capture, responseVar, index).split("\n"));
  const comments = [
    normalizeText(step.action) ? `// Action: ${normalizeText(step.action)}` : "",
    normalizeText(step.expected_result) ? `// Expected: ${normalizeText(step.expected_result)}` : ""
  ].filter(Boolean);

  return [
    ...comments,
    `const ${responseVar} = await api.request(${buildApiRequestLiteral(request)});`,
    ...captureLines,
    ...(validationLines.length ? validationLines : [`expect(${responseVar}.status).toBe(200);`]),
    `// ${stepLabel}`
  ].join("\n");
}

function buildGeneratedUiCode(step: StepAutomationLike, stepType: TestStepType) {
  const scope = stepType === "android" ? "android" : stepType === "ios" ? "ios" : "web";
  const title = normalizeText(step.action) || `Step ${step.step_order || 1}`;
  const expected = normalizeText(step.expected_result);

  return [
    `await ${scope}.step(${quoteJsString(title)}, async () => {`,
    `  // TODO: implement step automation.`,
    normalizeText(step.action) ? `  // Action: ${normalizeText(step.action)}` : "",
    expected ? `  // Expected: ${expected}` : "",
    "});"
  ].filter(Boolean).join("\n");
}

export function resolveStepAutomationCode(step: StepAutomationLike) {
  const stepType = normalizeStepType(step.step_type);
  const customCode = normalizeAutomationCode(step.automation_code);

  if (customCode) {
    return customCode;
  }

  if (stepType === "api") {
    return buildGeneratedApiCode(step, ensureApiRequest(step.api_request));
  }

  return buildGeneratedUiCode(step, stepType);
}

export function buildGroupAutomationCode(name: string, steps: Array<StepAutomationLike | SharedStepGroupStep>) {
  const groupName = normalizeText(name) || "Step group";
  const blocks = steps.map((step, index) =>
    `// ${groupName} · Step ${index + 1}\n${resolveStepAutomationCode({
      step_order: "step_order" in step && typeof step.step_order === "number" ? step.step_order : index + 1,
      action: step.action,
      expected_result: step.expected_result,
      step_type: step.step_type,
      automation_code: step.automation_code,
      api_request: step.api_request
    })}`
  );

  return [`// Group: ${groupName}`, ...blocks].join("\n\n");
}

export function buildCaseAutomationCode(title: string, steps: Array<StepAutomationLike | SharedStepGroupStep>) {
  const caseTitle = normalizeText(title) || "Test case";
  const blocks = steps.map((step, index) =>
    `// Step ${index + 1}\n${resolveStepAutomationCode({
      step_order: "step_order" in step && typeof step.step_order === "number" ? step.step_order : index + 1,
      action: step.action,
      expected_result: step.expected_result,
      step_type: step.step_type,
      automation_code: step.automation_code,
      api_request: step.api_request
    })}`
  );

  return [`// Test case: ${caseTitle}`, ...blocks].join("\n\n");
}

export function getStepTypeMeta(value?: string | null) {
  const type = normalizeStepType(value);
  return STEP_TYPE_OPTIONS.find((option) => option.value === type) || STEP_TYPE_OPTIONS[0];
}
