import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PlayIcon } from "./AppIcons";
import { FormField } from "./FormField";
import { SharedStepsIcon as SharedStepsIconGraphic } from "./SharedStepsIcon";
import { api } from "../lib/api";
import { resolveStepParameterText } from "../lib/stepParameters";
import {
  buildApiValidationAssertionCode,
  ensureApiRequest,
  getStepTypeMeta,
  normalizeApiRequest,
  normalizeAutomationCode,
  normalizeStepType,
  resolveStepAutomationCode,
  STEP_TYPE_OPTIONS
} from "../lib/stepAutomation";
import type { ApiRequestPreview, StepApiRequest, StepApiValidation, TestStepType } from "../types";

type StepAutomationInput = {
  step_order?: number;
  action?: string | null;
  expected_result?: string | null;
  step_type?: TestStepType | null;
  automation_code?: string | null;
  api_request?: StepApiRequest | null;
};

type JsonPathSelection = {
  path: string;
  value: unknown;
};

function IconFrame({
  children,
  size = 16,
  strokeWidth = 1.85
}: {
  children: ReactNode;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

export function StandardStepIcon({ size = 16 }: { size?: number }) {
  return (
    <IconFrame size={size}>
      <path d="M8 7h10" />
      <path d="M8 12h10" />
      <path d="M8 17h10" />
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}

export function LocalGroupIcon({ size = 16 }: { size?: number }) {
  return (
    <IconFrame size={size}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
      <path d="M4 10h16" />
    </IconFrame>
  );
}

export function AutomationCodeIcon({ size = 16 }: { size?: number }) {
  return (
    <IconFrame size={size}>
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
      <path d="m14 5-4 14" />
    </IconFrame>
  );
}

export function WebStepIcon({ size = 16 }: { size?: number }) {
  return (
    <IconFrame size={size}>
      <rect height="13" rx="2" width="18" x="3" y="5" />
      <path d="M3 9h18" />
      <path d="M7 20h10" />
    </IconFrame>
  );
}

export function ApiStepIcon({ size = 16 }: { size?: number }) {
  return (
    <IconFrame size={size}>
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
      <path d="M8 4h8" />
      <path d="M8 20h8" />
    </IconFrame>
  );
}

function ValidationPassedIcon({ size = 16 }: { size?: number }) {
  return (
    <IconFrame size={size}>
      <circle cx="12" cy="12" fill="currentColor" opacity="0.14" r="8" stroke="none" />
      <path d="m8.5 12.4 2.2 2.2 4.8-5.2" />
    </IconFrame>
  );
}

function ValidationFailedIcon({ size = 16 }: { size?: number }) {
  return (
    <IconFrame size={size}>
      <circle cx="12" cy="12" fill="currentColor" opacity="0.14" r="8" stroke="none" />
      <path d="m9 9 6 6" />
      <path d="m15 9-6 6" />
    </IconFrame>
  );
}

export function AndroidStepIcon({ size = 16 }: { size?: number }) {
  return (
    <IconFrame size={size}>
      <path d="M8 9h8a2 2 0 0 1 2 2v4H6v-4a2 2 0 0 1 2-2Z" />
      <path d="M9 9a3 3 0 0 1 6 0" />
      <path d="M9 5 7.5 3.5" />
      <path d="M15 5 16.5 3.5" />
      <circle cx="10" cy="11.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="14" cy="11.5" r=".8" fill="currentColor" stroke="none" />
      <path d="M8 15v3" />
      <path d="M16 15v3" />
    </IconFrame>
  );
}

export function IosStepIcon({ size = 16 }: { size?: number }) {
  return (
    <IconFrame size={size}>
      <rect height="16" rx="3" width="12" x="6" y="4" />
      <path d="M10 7h4" />
      <circle cx="12" cy="16.5" r=".8" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}

export function StepTypeIcon({
  type,
  size = 16
}: {
  type?: string | null;
  size?: number;
}) {
  switch (normalizeStepType(type)) {
    case "api":
      return <ApiStepIcon size={size} />;
    case "android":
      return <AndroidStepIcon size={size} />;
    case "ios":
      return <IosStepIcon size={size} />;
    case "web":
    default:
      return <WebStepIcon size={size} />;
  }
}

export function StepIconButton({
  className = "",
  ariaLabel,
  title,
  children,
  onClick,
  disabled = false
}: {
  className?: string;
  ariaLabel: string;
  title: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={["step-inline-tool", className].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

export function StepTypePickerButton({
  value,
  onChange,
  disabled = false
}: {
  value?: string | null;
  onChange: (next: TestStepType) => void;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const stepType = normalizeStepType(value);
  const meta = getStepTypeMeta(stepType);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="step-inline-tool-shell">
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="step-inline-tool is-type"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        title={`Step type: ${meta.label}`}
        type="button"
      >
        <StepTypeIcon size={15} type={stepType} />
      </button>
      {isOpen ? (
        <div className="step-type-menu" ref={menuRef} role="menu">
          {STEP_TYPE_OPTIONS.map((option) => (
            <button
              className={option.value === stepType ? "step-type-menu-item is-active" : "step-type-menu-item"}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              role="menuitemradio"
              title={option.label}
              type="button"
            >
              <StepTypeIcon size={15} type={option.value} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ApiHeaderRowsEditor({
  headers,
  onChange
}: {
  headers: Array<{ key: string; value: string }>;
  onChange: (headers: Array<{ key: string; value: string }>) => void;
}) {
  const nextHeaders = headers.length ? headers : [{ key: "", value: "" }];

  return (
    <div className="automation-grid-stack">
      {nextHeaders.map((header, index) => (
        <div className="automation-inline-grid" key={`header-${index}`}>
          <input
            placeholder="Header name"
            value={header.key}
            onChange={(event) => {
              const updated = nextHeaders.map((item, itemIndex) =>
                itemIndex === index ? { ...item, key: event.target.value } : item
              );
              onChange(updated);
            }}
          />
          <input
            placeholder="Header value"
            value={header.value}
            onChange={(event) => {
              const updated = nextHeaders.map((item, itemIndex) =>
                itemIndex === index ? { ...item, value: event.target.value } : item
              );
              onChange(updated);
            }}
          />
          <button
            className="ghost-button inline-button"
            onClick={() => onChange(nextHeaders.filter((_, itemIndex) => itemIndex !== index))}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="ghost-button inline-button"
        onClick={() => onChange([...nextHeaders, { key: "", value: "" }])}
        type="button"
      >
        Add header
      </button>
    </div>
  );
}

function ApiValidationRowsEditor({
  validations,
  onChange,
  results = [],
  parameterValues = {}
}: {
  validations: StepApiValidation[];
  onChange: (validations: StepApiValidation[]) => void;
  results?: ApiValidationResultPreview[];
  parameterValues?: Record<string, string>;
}) {
  const nextValidations = validations.length ? validations : [{ kind: "status", target: "", expected: "200" }];

  return (
    <div className="automation-grid-stack">
      {nextValidations.map((validation, index) => {
        const result = results[index] || null;
        const resolvedTarget = resolveStepParameterText(validation.target, parameterValues);
        const resolvedExpected = resolveStepParameterText(validation.expected, parameterValues);
        const showResolvedPreview =
          Boolean(validation.target || validation.expected)
          && (
            (validation.target || "") !== resolvedTarget
            || (validation.expected || "") !== resolvedExpected
          );

        return (
          <div className="automation-validation-row-shell" key={`validation-${index}`}>
            <div className="automation-validation-row">
              <select
                value={validation.kind}
                onChange={(event) => {
                  const updated = nextValidations.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          kind: event.target.value as StepApiValidation["kind"]
                        }
                      : item
                  ) as StepApiValidation[];
                  onChange(updated);
                }}
              >
                <option value="status">Status code</option>
                <option value="header">Header equals</option>
                <option value="body_contains">Body contains</option>
                <option value="json_path">JSON path equals</option>
              </select>
              <input
                placeholder={validation.kind === "status" ? "Status code" : validation.kind === "json_path" ? "JSON path" : validation.kind === "header" ? "Header name" : "Search text"}
                title={showResolvedPreview && resolvedTarget ? `Resolved target: ${resolvedTarget}` : undefined}
                value={validation.target || ""}
                onChange={(event) => {
                  const updated = nextValidations.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, target: event.target.value } : item
                  ) as StepApiValidation[];
                  onChange(updated);
                }}
              />
              <input
                placeholder={validation.kind === "status" ? "Expected status" : "Expected value"}
                title={showResolvedPreview && resolvedExpected ? `Resolved expected: ${resolvedExpected}` : undefined}
                value={validation.expected || ""}
                onChange={(event) => {
                  const updated = nextValidations.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, expected: event.target.value } : item
                  ) as StepApiValidation[];
                  onChange(updated);
                }}
              />
              {result ? (
                <span
                  className={result.passed ? "automation-validation-status is-passed" : "automation-validation-status is-failed"}
                  title={result.summary}
                >
                  {result.passed ? <ValidationPassedIcon size={14} /> : <ValidationFailedIcon size={14} />}
                </span>
              ) : (
                <span aria-hidden="true" className="automation-validation-status is-idle" />
              )}
              <button
                className="ghost-button inline-button"
                onClick={() => onChange(nextValidations.filter((_, itemIndex) => itemIndex !== index) as StepApiValidation[])}
                type="button"
              >
                Remove
              </button>
            </div>
            {showResolvedPreview ? (
              <div className="automation-validation-preview">
                <span>Using test data</span>
                <span>{resolvedTarget || "—"}</span>
                <span>{resolvedExpected || "—"}</span>
              </div>
            ) : null}
          </div>
        );
      })}
      <button
        className="ghost-button inline-button"
        onClick={() => onChange([...nextValidations, { kind: "status" as const, target: "", expected: "200" }] as StepApiValidation[])}
        type="button"
      >
        Add validation
      </button>
    </div>
  );
}

function resolveApiRequestParameters(request: StepApiRequest | null, values: Record<string, string> = {}) {
  if (!request) {
    return null;
  }

  return {
    ...request,
    url: resolveStepParameterText(request.url, values),
    body: resolveStepParameterText(request.body, values),
    headers: (request.headers || []).map((header) => ({
      key: resolveStepParameterText(header.key, values),
      value: resolveStepParameterText(header.value, values)
    })),
    validations: (request.validations || []).map((validation) => ({
      ...validation,
      target: resolveStepParameterText(validation.target, values),
      expected: resolveStepParameterText(validation.expected, values)
    }))
  } satisfies StepApiRequest;
}

function buildChildJsonPath(parentPath: string, key: string | number) {
  if (typeof key === "number") {
    return `${parentPath}[${key}]`;
  }

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return `${parentPath}.${key}`;
  }

  return `${parentPath}[${JSON.stringify(key)}]`;
}

function summarizeJsonValue(value: unknown) {
  if (Array.isArray(value)) {
    return {
      typeLabel: "array",
      preview: `${value.length} item${value.length === 1 ? "" : "s"}`
    };
  }

  if (value && typeof value === "object") {
    const keyCount = Object.keys(value as Record<string, unknown>).length;
    return {
      typeLabel: "object",
      preview: `${keyCount} field${keyCount === 1 ? "" : "s"}`
    };
  }

  if (typeof value === "string") {
    return {
      typeLabel: "string",
      preview: value.length > 96 ? `${value.slice(0, 93)}...` : value || '""'
    };
  }

  if (typeof value === "number") {
    return {
      typeLabel: "number",
      preview: String(value)
    };
  }

  if (typeof value === "boolean") {
    return {
      typeLabel: "boolean",
      preview: String(value)
    };
  }

  if (value === null) {
    return {
      typeLabel: "null",
      preview: "null"
    };
  }

  return {
    typeLabel: "unknown",
    preview: ""
  };
}

function stringifyJsonSelectionValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatJsonSelectionValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type ApiValidationResultPreview = {
  id: string;
  label: string;
  summary: string;
  passed: boolean;
};

function parseJsonPath(path: string) {
  const normalized = String(path || "").trim();

  if (!normalized || normalized === "$") {
    return [];
  }

  if (!normalized.startsWith("$")) {
    throw new Error("JPath must start with $");
  }

  const tokens: Array<string | number> = [];
  let index = 1;

  while (index < normalized.length) {
    const current = normalized[index];

    if (current === ".") {
      index += 1;
      const nextIndex = index;

      while (index < normalized.length && normalized[index] !== "." && normalized[index] !== "[") {
        index += 1;
      }

      const token = normalized.slice(nextIndex, index).trim();

      if (!token) {
        throw new Error("JPath contains an empty property segment");
      }

      tokens.push(token);
      continue;
    }

    if (current === "[") {
      index += 1;

      if (index >= normalized.length) {
        throw new Error("JPath is missing a closing bracket");
      }

      const quote = normalized[index];

      if (quote === "\"" || quote === "'") {
        index += 1;
        const nextIndex = index;

        while (index < normalized.length && normalized[index] !== quote) {
          index += 1;
        }

        if (index >= normalized.length) {
          throw new Error("JPath has an unterminated quoted property");
        }

        const token = normalized.slice(nextIndex, index);
        index += 1;

        if (normalized[index] !== "]") {
          throw new Error("JPath has an invalid quoted property segment");
        }

        index += 1;
        tokens.push(token);
        continue;
      }

      const nextIndex = index;

      while (index < normalized.length && normalized[index] !== "]") {
        index += 1;
      }

      if (index >= normalized.length) {
        throw new Error("JPath is missing a closing bracket");
      }

      const rawToken = normalized.slice(nextIndex, index).trim();
      index += 1;

      if (!/^\d+$/.test(rawToken)) {
        throw new Error("Only numeric array indexes are supported in bracket notation");
      }

      tokens.push(Number(rawToken));
      continue;
    }

    throw new Error(`Unexpected token "${current}" in JPath`);
  }

  return tokens;
}

function readJsonPathValue(source: unknown, path: string) {
  try {
    const tokens = parseJsonPath(path);
    let current: unknown = source;

    for (const token of tokens) {
      if (typeof token === "number") {
        if (!Array.isArray(current)) {
          return { found: false as const, error: `Path ${path} does not point to an array before [${token}]` };
        }

        if (token < 0 || token >= current.length) {
          return { found: false as const, error: `Path ${path} is missing array index [${token}]` };
        }

        current = current[token];
        continue;
      }

      if (!current || typeof current !== "object" || !(token in (current as Record<string, unknown>))) {
        return { found: false as const, error: `Path ${path} is missing property "${token}"` };
      }

      current = (current as Record<string, unknown>)[token];
    }

    return { found: true as const, value: current };
  } catch (error) {
    return {
      found: false as const,
      error: error instanceof Error ? error.message : "Invalid JPath"
    };
  }
}

function parseAssertionExpectedValue(value?: string | null) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "";
  }

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  if (normalized === "null") {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }

  if (/^[\[{"]/.test(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return normalized;
    }
  }

  return normalized;
}

function areAssertionValuesEqual(left: unknown, right: unknown) {
  if (left === right) {
    return true;
  }

  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  return false;
}

function createValidationLabel(validation: StepApiValidation, index: number) {
  const kind = validation.kind || "status";
  const target = String(validation.target || "").trim();

  if (kind === "status") {
    return `Assertion ${index + 1}: status code`;
  }

  if (kind === "header") {
    return `Assertion ${index + 1}: header ${target || "content-type"}`;
  }

  if (kind === "body_contains") {
    return `Assertion ${index + 1}: body contains`;
  }

  return `Assertion ${index + 1}: JPath ${target || "$"}`;
}

function evaluateValidationResult(
  preview: ApiRequestPreview,
  validation: StepApiValidation,
  index: number,
  parameterValues: Record<string, string>
): ApiValidationResultPreview {
  const resolvedValidation: StepApiValidation = {
    ...validation,
    target: resolveStepParameterText(validation.target, parameterValues),
    expected: resolveStepParameterText(validation.expected, parameterValues)
  };
  const label = createValidationLabel(resolvedValidation, index);
  const kind = validation.kind || "status";
  const target = String(resolvedValidation.target || "").trim();
  const expected = String(resolvedValidation.expected || "").trim();

  if (kind === "status") {
    const expectedStatus = Number(expected) || 200;
    const passed = preview.response.status === expectedStatus;
    return {
      id: `validation-${index}`,
      label,
      passed,
      summary: passed
        ? `Matched expected status ${expectedStatus}.`
        : `Expected status ${expectedStatus}, received ${preview.response.status}.`
    };
  }

  if (kind === "header") {
    const headerName = (target || "content-type").toLowerCase();
    const actual = preview.response.headers[headerName] || "";
    const passed = actual === expected;
    return {
      id: `validation-${index}`,
      label,
      passed,
      summary: passed
        ? `Header matched ${headerName}.`
        : `Expected "${expected}", received "${actual || "(empty)"}".`
    };
  }

  if (kind === "body_contains") {
    const passed = String(preview.response.body_text || "").includes(expected);
    return {
      id: `validation-${index}`,
      label,
      passed,
      summary: passed
        ? "Expected text was found in the response body."
        : `Could not find "${expected}" in the response body.`
    };
  }

  if (preview.response.body_json === null || preview.response.body_json === undefined) {
    return {
      id: `validation-${index}`,
      label,
      passed: false,
      summary: "Response body is not JSON, so this JPath assertion could not be evaluated."
    };
  }

  const resolved = readJsonPathValue(preview.response.body_json, target || "$");

  if (!resolved.found) {
    return {
      id: `validation-${index}`,
      label,
      passed: false,
      summary: resolved.error
    };
  }

  const expectedValue = parseAssertionExpectedValue(expected);
  const passed = areAssertionValuesEqual(resolved.value, expectedValue);
  return {
    id: `validation-${index}`,
    label,
    passed,
    summary: passed
      ? `Matched ${target || "$"} = ${stringifyJsonSelectionValue(resolved.value)}.`
      : `Expected ${stringifyJsonSelectionValue(expectedValue)}, received ${stringifyJsonSelectionValue(resolved.value)}.`
  };
}

function JsonResponseTreeNode({
  label,
  value,
  path,
  depth,
  selectedPath,
  onSelect
}: {
  label: string;
  value: unknown;
  path: string;
  depth: number;
  selectedPath: string;
  onSelect: (selection: JsonPathSelection) => void;
}) {
  const isExpandable = Boolean(value) && typeof value === "object";
  const [isExpanded, setIsExpanded] = useState(depth < 1);
  const summary = summarizeJsonValue(value);
  const entries = useMemo(() => {
    if (Array.isArray(value)) {
      return value.map((item, index) => [index, item] as const);
    }

    if (value && typeof value === "object") {
      return Object.entries(value as Record<string, unknown>);
    }

    return [];
  }, [value]);

  return (
    <div className="api-response-tree-node">
      <div className="api-response-tree-row">
        {isExpandable ? (
          <button
            aria-label={isExpanded ? `Collapse ${label}` : `Expand ${label}`}
            className="api-response-tree-toggle"
            onClick={() => setIsExpanded((current) => !current)}
            type="button"
          >
            <span aria-hidden="true" className={isExpanded ? "api-response-tree-chevron is-expanded" : "api-response-tree-chevron"}>
              <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </span>
          </button>
        ) : (
          <span aria-hidden="true" className="api-response-tree-toggle api-response-tree-toggle--spacer" />
        )}
        <button
          aria-pressed={selectedPath === path}
          className={selectedPath === path ? "api-response-tree-select is-selected" : "api-response-tree-select"}
          onClick={() => onSelect({ path, value })}
          type="button"
        >
          <span className="api-response-tree-key">{label}</span>
          <span className="api-response-tree-type">{summary.typeLabel}</span>
          <span className="api-response-tree-preview">{summary.preview}</span>
        </button>
      </div>
      {isExpandable && isExpanded ? (
        <div className="api-response-tree-children">
          {entries.map(([childKey, childValue]) => (
            <JsonResponseTreeNode
              depth={depth + 1}
              key={buildChildJsonPath(path, childKey)}
              label={String(childKey)}
              onSelect={onSelect}
              path={buildChildJsonPath(path, childKey)}
              selectedPath={selectedPath}
              value={childValue}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CodePreviewDialog({
  title,
  subtitle,
  code,
  onClose
}: {
  title: string;
  subtitle: string;
  code: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop modal-backdrop--scroll" onClick={onClose} role="presentation">
      <div
        aria-modal="true"
        className="modal-card resource-modal-card automation-code-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="resource-modal-header">
          <div className="resource-modal-title">
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <button aria-label="Close code preview" className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="resource-form">
          <div className="resource-form-body">
            <pre className="automation-code-block">
              <code>{code}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StepAutomationDialog({
  title,
  subtitle,
  step,
  parameterValues = {},
  onClose,
  onSave
}: {
  title: string;
  subtitle: string;
  step: StepAutomationInput;
  parameterValues?: Record<string, string>;
  onClose: () => void;
  onSave: (input: { step_type: TestStepType; automation_code: string; api_request: StepApiRequest | null }) => void;
}) {
  const [stepType, setStepType] = useState<TestStepType>(normalizeStepType(step.step_type));
  const [automationCode, setAutomationCode] = useState(normalizeAutomationCode(step.automation_code));
  const [apiRequest, setApiRequest] = useState<StepApiRequest>(ensureApiRequest(step.api_request));
  const [apiPreview, setApiPreview] = useState<ApiRequestPreview | null>(null);
  const [apiPreviewError, setApiPreviewError] = useState("");
  const [apiPreviewMessage, setApiPreviewMessage] = useState("");
  const [isRunningApiRequest, setIsRunningApiRequest] = useState(false);
  const [selectedJsonPath, setSelectedJsonPath] = useState<JsonPathSelection | null>(null);

  useEffect(() => {
    setStepType(normalizeStepType(step.step_type));
    setAutomationCode(normalizeAutomationCode(step.automation_code));
    setApiRequest(ensureApiRequest(step.api_request));
    setApiPreview(null);
    setApiPreviewError("");
    setApiPreviewMessage("");
    setSelectedJsonPath(null);
  }, [step]);

  useEffect(() => {
    if (stepType !== "api") {
      setApiPreview(null);
      setApiPreviewError("");
      setApiPreviewMessage("");
      setSelectedJsonPath(null);
    }
  }, [stepType]);

  const normalizedApiRequest = useMemo(
    () => (stepType === "api" ? normalizeApiRequest(apiRequest) : null),
    [apiRequest, stepType]
  );
  const resolvedApiRequest = useMemo(
    () => normalizeApiRequest(resolveApiRequestParameters(normalizedApiRequest, parameterValues)),
    [normalizedApiRequest, parameterValues]
  );

  const previewCode = useMemo(
    () =>
      resolveStepAutomationCode({
        step_order: step.step_order || 1,
        action: step.action || null,
        expected_result: step.expected_result || null,
        step_type: stepType,
        automation_code: automationCode,
        api_request: normalizedApiRequest
      }),
    [automationCode, normalizedApiRequest, step.action, step.expected_result, step.step_order, stepType]
  );
  const responseHeaderEntries = useMemo(
    () => Object.entries(apiPreview?.response.headers || {}).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
    [apiPreview]
  );
  const validationResults = useMemo(
    () => (apiPreview ? (apiRequest.validations || []).map((validation, index) => evaluateValidationResult(apiPreview, validation, index, parameterValues)) : []),
    [apiPreview, apiRequest.validations, parameterValues]
  );
  const selectedJsonValue = selectedJsonPath ? formatJsonSelectionValue(selectedJsonPath.value) : "";

  const handleRunApiRequest = async () => {
    if (!resolvedApiRequest?.url) {
      setApiPreview(null);
      setApiPreviewError("Enter a valid absolute request URL before running this API step.");
      setApiPreviewMessage("");
      return;
    }

    setIsRunningApiRequest(true);
    setApiPreviewError("");
    setApiPreviewMessage("");

    try {
      const result = await api.testSteps.runApiRequest({
        api_request: resolvedApiRequest
      });

      setApiPreview(result);
      setSelectedJsonPath(null);
      setApiPreviewMessage(`Captured response ${result.response.status} in ${result.response.duration_ms} ms.`);
    } catch (error) {
      setApiPreview(null);
      setSelectedJsonPath(null);
      setApiPreviewError(error instanceof Error ? error.message : "Unable to run the API request.");
      setApiPreviewMessage("");
    } finally {
      setIsRunningApiRequest(false);
    }
  };

  const handleInsertJsonPathAssertion = () => {
    if (!selectedJsonPath) {
      return;
    }

    const nextValidation: StepApiValidation = {
      kind: "json_path",
      target: selectedJsonPath.path,
      expected: stringifyJsonSelectionValue(selectedJsonPath.value)
    };
    const existingValidations = apiRequest.validations || [];
    const alreadyHasValidation = existingValidations.some((validation) =>
      validation.kind === nextValidation.kind
      && (validation.target || "") === nextValidation.target
      && (validation.expected || "") === nextValidation.expected
    );
    const nextValidations = alreadyHasValidation ? existingValidations : [...existingValidations, nextValidation];
    const nextApiRequest = {
      ...apiRequest,
      validations: nextValidations
    };
    const responseVar = `response${step.step_order || 1}`;
    const assertionSnippet = buildApiValidationAssertionCode(nextValidation, responseVar);
    const currentCustomCode = normalizeAutomationCode(automationCode);

    setApiRequest(nextApiRequest);

    if (currentCustomCode) {
      setAutomationCode(
        currentCustomCode.includes(assertionSnippet)
          ? currentCustomCode
          : `${currentCustomCode}\n${assertionSnippet}`
      );
    } else {
      setAutomationCode(resolveStepAutomationCode({
        step_order: step.step_order || 1,
        action: step.action || null,
        expected_result: step.expected_result || null,
        step_type: "api",
        automation_code: "",
        api_request: normalizeApiRequest(nextApiRequest)
      }));
    }

    setApiPreviewMessage(`Added ${selectedJsonPath.path} to the response validations and custom override.`);
    setApiPreviewError("");
  };

  return (
    <div className="modal-backdrop modal-backdrop--scroll" onClick={onClose} role="presentation">
      <div
        aria-modal="true"
        className="modal-card resource-modal-card automation-editor-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="resource-modal-header">
          <div className="resource-modal-title">
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <button aria-label="Close step automation editor" className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="resource-form">
          <div className="resource-form-body automation-editor-body">
            <div className="automation-step-type-row">
              {STEP_TYPE_OPTIONS.map((option) => (
                <button
                  className={option.value === stepType ? "automation-type-pill is-active" : "automation-type-pill"}
                  key={option.value}
                  onClick={() => setStepType(option.value)}
                  type="button"
                >
                  <StepTypeIcon size={15} type={option.value} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>

            {stepType === "api" ? (
              <div className="automation-api-editor">
                <div className="automation-inline-grid">
                  <FormField label="HTTP method">
                    <select
                      value={apiRequest.method || "GET"}
                      onChange={(event) =>
                        setApiRequest((current) => ({
                          ...current,
                          method: event.target.value as StepApiRequest["method"]
                        }))
                      }
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="PATCH">PATCH</option>
                      <option value="DELETE">DELETE</option>
                      <option value="HEAD">HEAD</option>
                      <option value="OPTIONS">OPTIONS</option>
                    </select>
                  </FormField>
                  <FormField label="Request URL" required>
                    <input
                      placeholder="https://api.example.com/orders/@orderId"
                      value={apiRequest.url || ""}
                      onChange={(event) =>
                        setApiRequest((current) => ({
                          ...current,
                          url: event.target.value
                        }))
                      }
                    />
                  </FormField>
                </div>

                <FormField
                  label="Headers"
                  hint="Use @param tokens inside header names or values when you want the same case-level data in request setup."
                >
                  <ApiHeaderRowsEditor
                    headers={apiRequest.headers || []}
                    onChange={(headers) => setApiRequest((current) => ({ ...current, headers }))}
                  />
                </FormField>

                <div className="automation-inline-grid">
                  <FormField label="Body mode">
                    <select
                      value={apiRequest.body_mode || "none"}
                      onChange={(event) =>
                        setApiRequest((current) => ({
                          ...current,
                          body_mode: event.target.value as StepApiRequest["body_mode"]
                        }))
                      }
                    >
                      <option value="none">None</option>
                      <option value="json">JSON</option>
                      <option value="text">Text</option>
                      <option value="xml">XML</option>
                      <option value="form">Form</option>
                    </select>
                  </FormField>
                </div>

                {(apiRequest.body_mode || "none") !== "none" ? (
                  <FormField label="Request body">
                    <textarea
                      rows={6}
                      value={apiRequest.body || ""}
                      onChange={(event) =>
                        setApiRequest((current) => ({
                          ...current,
                          body: event.target.value
                        }))
                      }
                    />
                  </FormField>
                ) : null}

                <div className="automation-response-shell">
                  <div className="automation-response-header">
                    <div>
                      <strong>API response capture</strong>
                      <span>Run the current request with the active test data values, inspect the response hierarchy, and lift a JSON path into your assertions.</span>
                    </div>
                    <button
                      className="primary-button automation-run-button"
                      disabled={isRunningApiRequest || !resolvedApiRequest?.url}
                      onClick={() => void handleRunApiRequest()}
                      type="button"
                    >
                      <PlayIcon />
                      <span>{isRunningApiRequest ? "Running..." : "Run"}</span>
                    </button>
                  </div>

                  {apiPreviewError ? <div className="inline-message error-message">{apiPreviewError}</div> : null}
                  {apiPreviewMessage ? <div className="inline-message success-message">{apiPreviewMessage}</div> : null}

                  {apiPreview ? (
                    <div className="automation-response-results">
                      <div className="automation-response-summary">
                        <span className={apiPreview.response.ok ? "automation-response-pill is-success" : "automation-response-pill is-danger"}>
                          {apiPreview.response.status}
                        </span>
                        <span className="automation-response-pill">{apiPreview.request.method}</span>
                        <span className="automation-response-pill">{apiPreview.response.duration_ms} ms</span>
                        <span className="automation-response-pill">
                          {apiPreview.response.content_type || "Unknown content type"}
                        </span>
                      </div>

                      {responseHeaderEntries.length ? (
                        <div className="automation-response-meta">
                          <strong>Response headers</strong>
                          <div className="automation-response-headers">
                            {responseHeaderEntries.map(([key, value]) => (
                              <span className="automation-response-header-chip" key={key}>
                                <strong>{key}</strong>
                                <span>{value}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {apiPreview.response.body_json !== null && apiPreview.response.body_json !== undefined ? (
                        <div className="automation-response-tree-shell">
                          <div className="automation-response-tree-panel">
                            <strong>JSON path (JPath) explorer</strong>
                            <span>Select any node to stage a JSON path assertion.</span>
                            <div className="api-response-tree">
                              <JsonResponseTreeNode
                                depth={0}
                                label="$"
                                onSelect={setSelectedJsonPath}
                                path="$"
                                selectedPath={selectedJsonPath?.path || ""}
                                value={apiPreview.response.body_json}
                              />
                            </div>
                          </div>
                          <div className="automation-response-selection">
                            <strong>Selected node</strong>
                            <span>{selectedJsonPath ? selectedJsonPath.path : "Choose a node from the JSON hierarchy to build a JPath assertion."}</span>
                            {selectedJsonPath ? (
                              <>
                                <pre className="automation-code-block automation-code-block--compact automation-code-block--selection">
                                  <code>{selectedJsonValue}</code>
                                </pre>
                                <button className="ghost-button" onClick={handleInsertJsonPathAssertion} type="button">
                                  <AutomationCodeIcon />
                                  <span>Add JPath assertion to override</span>
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="detail-summary">
                          <strong>Structured explorer unavailable</strong>
                          <span>This response is not JSON, so only the raw body preview is available for this run.</span>
                        </div>
                      )}

                      <div className="automation-response-meta">
                        <strong>Raw response body</strong>
                        <pre className="automation-code-block automation-code-block--compact automation-code-block--selection">
                          <code>{apiPreview.response.body_text || "No response body returned."}</code>
                        </pre>
                      </div>
                    </div>
                  ) : null}
                </div>

                <FormField
                  label="Response validations"
                  hint="Add the checks that should run after the response returns."
                >
                  <ApiValidationRowsEditor
                    parameterValues={parameterValues}
                    results={validationResults}
                    validations={apiRequest.validations || []}
                    onChange={(validations) => setApiRequest((current) => ({ ...current, validations }))}
                  />
                </FormField>

                <FormField
                  label="Custom code override"
                  hint="Leave blank to use the generated request snippet in group and case-level consolidated code views. JPath selections can seed this override automatically."
                >
                  <textarea rows={8} value={automationCode} onChange={(event) => setAutomationCode(event.target.value)} />
                </FormField>
              </div>
            ) : (
              <FormField
                label="Step automation code"
                hint="Use the same @param tokens from the manual step text when you need case-level data inside automation."
              >
                <textarea rows={14} value={automationCode} onChange={(event) => setAutomationCode(event.target.value)} />
              </FormField>
            )}

            <div className="detail-summary automation-preview-shell">
              <strong>Consolidated preview</strong>
              <span>This is what group and test-case level code views will use for this step.</span>
              <pre className="automation-code-block automation-code-block--compact">
                <code>{previewCode}</code>
              </pre>
            </div>
          </div>
          <div className="resource-form-actions action-row">
            <button
              className="primary-button"
              onClick={() =>
                onSave({
                  step_type: stepType,
                  automation_code: normalizeAutomationCode(automationCode),
                  api_request: normalizedApiRequest
                })
              }
              type="button"
            >
              Save automation
            </button>
            <button className="ghost-button" onClick={onClose} type="button">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SharedGroupLevelIcon({
  kind,
  size = 16
}: {
  kind?: "local" | "reusable" | null;
  size?: number;
}) {
  if (kind === "reusable") {
    return <SharedStepsIconGraphic size={size} />;
  }

  return <LocalGroupIcon size={size} />;
}
