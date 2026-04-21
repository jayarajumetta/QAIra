import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FormField } from "./FormField";
import { SharedStepsIcon as SharedStepsIconGraphic } from "./SharedStepsIcon";
import {
  ensureApiRequest,
  getStepTypeMeta,
  normalizeApiRequest,
  normalizeAutomationCode,
  normalizeStepType,
  resolveStepAutomationCode,
  STEP_TYPE_OPTIONS
} from "../lib/stepAutomation";
import type { StepApiRequest, StepApiValidation, TestStepType } from "../types";

type StepAutomationInput = {
  action?: string | null;
  expected_result?: string | null;
  step_type?: TestStepType | null;
  automation_code?: string | null;
  api_request?: StepApiRequest | null;
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
  onChange
}: {
  validations: StepApiValidation[];
  onChange: (validations: StepApiValidation[]) => void;
}) {
  const nextValidations = validations.length ? validations : [{ kind: "status", target: "", expected: "200" }];

  return (
    <div className="automation-grid-stack">
      {nextValidations.map((validation, index) => (
        <div className="automation-validation-row" key={`validation-${index}`}>
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
            value={validation.expected || ""}
            onChange={(event) => {
              const updated = nextValidations.map((item, itemIndex) =>
                itemIndex === index ? { ...item, expected: event.target.value } : item
              ) as StepApiValidation[];
              onChange(updated);
            }}
          />
          <button
            className="ghost-button inline-button"
            onClick={() => onChange(nextValidations.filter((_, itemIndex) => itemIndex !== index) as StepApiValidation[])}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}
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
  onClose,
  onSave
}: {
  title: string;
  subtitle: string;
  step: StepAutomationInput;
  onClose: () => void;
  onSave: (input: { step_type: TestStepType; automation_code: string; api_request: StepApiRequest | null }) => void;
}) {
  const [stepType, setStepType] = useState<TestStepType>(normalizeStepType(step.step_type));
  const [automationCode, setAutomationCode] = useState(normalizeAutomationCode(step.automation_code));
  const [apiRequest, setApiRequest] = useState<StepApiRequest>(ensureApiRequest(step.api_request));

  useEffect(() => {
    setStepType(normalizeStepType(step.step_type));
    setAutomationCode(normalizeAutomationCode(step.automation_code));
    setApiRequest(ensureApiRequest(step.api_request));
  }, [step]);

  const previewCode = useMemo(
    () =>
      resolveStepAutomationCode({
        step_order: 1,
        action: step.action || null,
        expected_result: step.expected_result || null,
        step_type: stepType,
        automation_code: automationCode,
        api_request: stepType === "api" ? normalizeApiRequest(apiRequest) : null
      }),
    [apiRequest, automationCode, step.action, step.expected_result, stepType]
  );

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

                <FormField
                  label="Response validations"
                  hint="Add the checks that should run after the response returns."
                >
                  <ApiValidationRowsEditor
                    validations={apiRequest.validations || []}
                    onChange={(validations) => setApiRequest((current) => ({ ...current, validations }))}
                  />
                </FormField>

                <FormField
                  label="Custom code override"
                  hint="Leave blank to use the generated request snippet in group and case-level consolidated code views."
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
                  api_request: stepType === "api" ? normalizeApiRequest(apiRequest) : null
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
