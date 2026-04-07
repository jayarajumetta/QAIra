import type { AiDesignImageInput, AiDesignedTestCaseCandidate, Integration, Requirement, TestCase } from "../types";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { FormField } from "./FormField";

export function AiDesignStudioModal({
  eyebrow,
  requirementLabel,
  requirementHelpText,
  requirements,
  selectedRequirementIds,
  allowMultipleRequirements,
  onRequirementSelectionChange,
  integrations,
  integrationId,
  onIntegrationIdChange,
  maxCases,
  onMaxCasesChange,
  additionalContext,
  onAdditionalContextChange,
  externalLinksText,
  onExternalLinksTextChange,
  referenceImages,
  onAddImages,
  onRemoveImage,
  appTypeName,
  existingCases,
  existingCasesTitle,
  existingCasesSubtitle,
  previewCases,
  onRemovePreviewCase,
  onTogglePreviewRequirement,
  previewMessage,
  previewTone,
  isPreviewing,
  isAccepting,
  onPreview,
  onAccept,
  onClose,
  disablePreview,
  disableAccept,
  closeDisabled = false,
  acceptLabel,
  dialogClassName
}: {
  eyebrow: string;
  requirementLabel: string;
  requirementHelpText: string;
  requirements: Requirement[];
  selectedRequirementIds: string[];
  allowMultipleRequirements: boolean;
  onRequirementSelectionChange: (requirementIds: string[]) => void;
  integrations: Integration[];
  integrationId: string;
  onIntegrationIdChange: (value: string) => void;
  maxCases: number;
  onMaxCasesChange: (value: number) => void;
  additionalContext: string;
  onAdditionalContextChange: (value: string) => void;
  externalLinksText: string;
  onExternalLinksTextChange: (value: string) => void;
  referenceImages: AiDesignImageInput[];
  onAddImages: (files: FileList | null) => void;
  onRemoveImage: (imageUrl: string) => void;
  appTypeName: string;
  existingCases: TestCase[];
  existingCasesTitle: string;
  existingCasesSubtitle: string;
  previewCases: AiDesignedTestCaseCandidate[];
  onRemovePreviewCase: (clientId: string) => void;
  onTogglePreviewRequirement?: (clientId: string, requirementId: string) => void;
  previewMessage: string;
  previewTone: "success" | "error";
  isPreviewing: boolean;
  isAccepting: boolean;
  onPreview: () => void;
  onAccept: () => void;
  onClose: () => void;
  disablePreview: boolean;
  disableAccept: boolean;
  closeDisabled?: boolean;
  acceptLabel: string;
  dialogClassName?: string;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const selectedRequirements = requirements.filter((requirement) => selectedRequirementIds.includes(requirement.id));

  const handleRequirementToggle = (requirementId: string, checked: boolean) => {
    if (allowMultipleRequirements) {
      onRequirementSelectionChange(
        checked
          ? [...new Set([...selectedRequirementIds, requirementId])]
          : selectedRequirementIds.filter((id) => id !== requirementId)
      );
      return;
    }

    onRequirementSelectionChange(checked ? [requirementId] : []);
  };

  return (
    <div className="modal-backdrop" onClick={() => !closeDisabled && onClose()} role="presentation">
      <div
        aria-label="AI test case generation"
        aria-modal="true"
        className={dialogClassName ? `modal-card ai-modal-card ai-design-modal ${dialogClassName}` : "modal-card ai-modal-card ai-design-modal"}
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="ai-studio-header">
          <div className="ai-studio-header-copy">
            <p className="eyebrow">{eyebrow}</p>
            <h3>AI Test Case Generation</h3>
            <p>Shape the LLM prompt with source requirements, extra context, photos, and external links before reviewing the generated cases for approval.</p>
          </div>
          <button className="ghost-button" disabled={closeDisabled} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="ai-studio-shell">
          <div className="ai-studio-sidebar">
            <section className="ai-studio-panel">
              <div className="panel-head">
                <div>
                  <h3>{requirementLabel}</h3>
                  <p>{requirementHelpText}</p>
                </div>
              </div>

              {allowMultipleRequirements ? (
                <div className="modal-case-picker ai-studio-requirement-picker">
                  {requirements.map((requirement) => (
                    <label className="modal-case-option requirement-link-option" key={requirement.id}>
                      <input
                        checked={selectedRequirementIds.includes(requirement.id)}
                        data-autofocus={requirements[0]?.id === requirement.id ? "true" : undefined}
                        onChange={(event) => handleRequirementToggle(requirement.id, event.target.checked)}
                        type="checkbox"
                      />
                      <div>
                        <strong>{requirement.title}</strong>
                        <span>{requirement.description || "No description available."}</span>
                        <span className="requirement-link-option-meta">Priority P{requirement.priority ?? 3} · {requirement.status || "open"}</span>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <FormField label={requirementLabel}>
                  <select
                    data-autofocus="true"
                    value={selectedRequirementIds[0] || ""}
                    onChange={(event) => onRequirementSelectionChange(event.target.value ? [event.target.value] : [])}
                  >
                    {requirements.map((requirement) => (
                      <option key={requirement.id} value={requirement.id}>
                        {requirement.title}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}

              <div className="detail-summary">
                <strong>{selectedRequirements.length ? `${selectedRequirements.length} requirement${selectedRequirements.length === 1 ? "" : "s"} selected` : "No requirements selected"}</strong>
                <span>{appTypeName || "No app type selected"} controls where approved test cases will be created.</span>
              </div>

              {selectedRequirements.length ? (
                <div className="selection-chip-row">
                  {selectedRequirements.map((requirement) => (
                    <span className="selection-chip is-selected" key={requirement.id}>
                      {requirement.title}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="record-grid">
                <FormField label="LLM integration">
                  <select value={integrationId} onChange={(event) => onIntegrationIdChange(event.target.value)}>
                    <option value="">Default active integration</option>
                    {integrations.map((integration) => (
                      <option key={integration.id} value={integration.id}>
                        {integration.name}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Draft cases to generate">
                  <input min="1" max="20" type="number" value={maxCases} onChange={(event) => onMaxCasesChange(Number(event.target.value) || 6)} />
                </FormField>
              </div>
            </section>

            <section className="ai-studio-panel">
              <div className="panel-head">
                <div>
                  <h3>Prompt context</h3>
                  <p>Provide the extra guidance the model should consider while drafting cases.</p>
                </div>
              </div>

              <FormField label="Additional context">
                <textarea
                  placeholder="Release goals, risky flows, browser/device notes, compliance rules, known gaps..."
                  rows={5}
                  value={additionalContext}
                  onChange={(event) => onAdditionalContextChange(event.target.value)}
                />
              </FormField>

              <FormField label="External links">
                <textarea
                  placeholder="One link per line"
                  rows={4}
                  value={externalLinksText}
                  onChange={(event) => onExternalLinksTextChange(event.target.value)}
                />
              </FormField>

              <FormField label="Reference photos">
                <input
                  accept="image/*"
                  multiple
                  onChange={(event) => {
                    onAddImages(event.target.files);
                    event.target.value = "";
                  }}
                  type="file"
                />
              </FormField>

              {referenceImages.length ? (
                <div className="ai-reference-image-list">
                  {referenceImages.map((image) => (
                    <article className="ai-reference-image-card" key={image.url}>
                      <div className="ai-reference-image-preview">
                        <img alt={image.name || "Reference upload"} src={image.url} />
                      </div>
                      <div className="ai-reference-image-copy">
                        <strong>{image.name || "Reference image"}</strong>
                        <span>Attached to the prompt</span>
                      </div>
                      <button className="ghost-button danger" onClick={() => onRemoveImage(image.url)} type="button">
                        Remove
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state compact">Add screenshots or reference photos to give the model visual context.</div>
              )}
            </section>
          </div>

          <div className="ai-studio-main">
            <div className="detail-summary">
              <strong>{appTypeName || "App type not selected"}</strong>
              <span>Approved drafts will be created as reusable test cases in the current app type.</span>
              <span>Preview each draft before acceptance and adjust requirement mapping when more than one source requirement is selected.</span>
            </div>

            {previewMessage ? <p className={previewTone === "error" ? "inline-message error-message" : "inline-message success-message"}>{previewMessage}</p> : null}

            {!integrations.length ? (
              <div className="inline-message error-message">
                No active LLM integrations are available yet. Create one in Integrations to use AI test case generation.
              </div>
            ) : null}

            <div className="action-row">
              <button className="primary-button" disabled={disablePreview} onClick={onPreview} type="button">
                {isPreviewing ? "Designing…" : "Generate Preview"}
              </button>
              <button className="ghost-button" disabled={closeDisabled} onClick={onClose} type="button">
                Close
              </button>
            </div>

            <div className="ai-modal-grid">
              <div className="detail-stack">
                <div className="panel-head">
                  <div>
                    <h3>{existingCasesTitle}</h3>
                    <p>{existingCasesSubtitle}</p>
                  </div>
                </div>

                <div className="stack-list">
                  {existingCases.map((testCase) => (
                    <div className="stack-item" key={testCase.id}>
                      <div>
                        <strong>{testCase.title}</strong>
                        <span>{testCase.description || "No description available."}</span>
                      </div>
                      <span className="count-pill">Existing</span>
                    </div>
                  ))}
                  {!existingCases.length ? <div className="empty-state compact">No existing cases are linked to the current selection yet.</div> : null}
                </div>
              </div>

              <div className="detail-stack">
                <div className="panel-head">
                  <div>
                    <h3>AI draft cases</h3>
                    <p>Review the generated drafts, adjust requirement mapping if needed, and remove any drafts you do not want to keep.</p>
                  </div>
                </div>

                <div className="ai-case-list">
                  {previewCases.map((item) => (
                    <article className="ai-case-card" key={item.client_id}>
                      <div className="step-card-top">
                        <div>
                          <strong>{item.title}</strong>
                          <span className="ai-case-meta">Priority {item.priority} · {item.step_count} steps</span>
                        </div>
                        <button className="ghost-button danger" onClick={() => onRemovePreviewCase(item.client_id)} type="button">
                          Delete
                        </button>
                      </div>

                      <span>{item.description || "No description generated."}</span>

                      {requirements.length ? (
                        <div className="ai-case-requirements">
                          <strong>Requirement mapping</strong>
                          <div className="selection-chip-row">
                            {requirements.map((requirement) => {
                              const isSelected = item.requirement_ids.includes(requirement.id);

                              return (
                                <button
                                  className={isSelected ? "selection-chip is-selected" : "selection-chip is-unselected"}
                                  disabled={!onTogglePreviewRequirement}
                                  key={`${item.client_id}-${requirement.id}`}
                                  onClick={() => onTogglePreviewRequirement?.(item.client_id, requirement.id)}
                                  type="button"
                                >
                                  {requirement.title}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      <div className="ai-case-steps">
                        {item.steps.map((step) => (
                          <div className="segment" key={`${item.client_id}-${step.step_order}`}>
                            <div>
                              <strong>Step {step.step_order}</strong>
                              <span>{step.action || "No action"}</span>
                            </div>
                            <span>{step.expected_result || "No expected result"}</span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                  {!previewCases.length ? <div className="empty-state compact">Generate a preview to review AI-drafted cases here.</div> : null}
                </div>
              </div>
            </div>

            <div className="action-row ai-studio-footer">
              <button className="primary-button" disabled={disableAccept} onClick={onAccept} type="button">
                {isAccepting ? "Accepting…" : acceptLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
