import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { api } from "../lib/api";
import type { Integration, Requirement, TestCase } from "../types";

type RequirementDraft = {
  title: string;
  description: string;
  priority: number;
  status: string;
};

type DesignedCaseDraft = {
  client_id: string;
  title: string;
  description: string;
  priority: number;
  steps: Array<{
    step_order: number;
    action: string;
    expected_result: string;
  }>;
  step_count: number;
};

const EMPTY_REQUIREMENT: RequirementDraft = {
  title: "",
  description: "",
  priority: 3,
  status: "open"
};

export function RequirementsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [projectId, setProjectId] = useState("");
  const [appTypeId, setAppTypeId] = useState("");
  const [selectedRequirementId, setSelectedRequirementId] = useState("");
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [draft, setDraft] = useState<RequirementDraft>(EMPTY_REQUIREMENT);
  const [isAiStudioOpen, setIsAiStudioOpen] = useState(false);
  const [aiRequirementId, setAiRequirementId] = useState("");
  const [integrationId, setIntegrationId] = useState("");
  const [maxCases, setMaxCases] = useState(6);
  const [previewCases, setPreviewCases] = useState<DesignedCaseDraft[]>([]);
  const [previewMessage, setPreviewMessage] = useState("");
  const [previewTone, setPreviewTone] = useState<"success" | "error">("success");

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list
  });
  const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: () => api.appTypes.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const requirementsQuery = useQuery({
    queryKey: ["requirements", projectId],
    queryFn: () => api.requirements.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const testCasesQuery = useQuery({
    queryKey: ["requirements-test-cases", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations", "llm"],
    queryFn: () => api.integrations.list({ type: "llm", is_active: true }),
    enabled: Boolean(session)
  });

  const createRequirement = useMutation({ mutationFn: api.requirements.create });
  const updateRequirement = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.requirements.update>[1] }) =>
      api.requirements.update(id, input)
  });
  const deleteRequirement = useMutation({ mutationFn: api.requirements.delete });
  const replaceMappings = useMutation({
    mutationFn: ({ requirementId, testCaseIds }: { requirementId: string; testCaseIds: string[] }) =>
      api.requirementTestCases.replace(requirementId, testCaseIds)
  });
  const previewDesignedCases = useMutation({
    mutationFn: ({ requirementId, input }: { requirementId: string; input: Parameters<typeof api.requirements.previewDesignedTestCases>[1] }) =>
      api.requirements.previewDesignedTestCases(requirementId, input)
  });
  const acceptDesignedCases = useMutation({
    mutationFn: ({ requirementId, input }: { requirementId: string; input: Parameters<typeof api.requirements.acceptDesignedTestCases>[1] }) =>
      api.requirements.acceptDesignedTestCases(requirementId, input)
  });

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const requirements = requirementsQuery.data || [];
  const testCases = testCasesQuery.data || [];
  const integrations = integrationsQuery.data || [];

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  useEffect(() => {
    if (!projectId && projects[0]) {
      setProjectId(projects[0].id);
    }
  }, [projectId, projects]);

  useEffect(() => {
    if (!appTypes.length) {
      setAppTypeId("");
      return;
    }

    if (!appTypes.some((item) => item.id === appTypeId)) {
      setAppTypeId(appTypes[0].id);
    }
  }, [appTypeId, appTypes]);

  useEffect(() => {
    if (!integrations.length) {
      setIntegrationId("");
      return;
    }

    if (!integrations.some((integration) => integration.id === integrationId)) {
      setIntegrationId(integrations[0].id);
    }
  }, [integrationId, integrations]);

  const selectedRequirement = useMemo(
    () => requirements.find((item) => item.id === selectedRequirementId) || requirements[0] || null,
    [requirements, selectedRequirementId]
  );

  const aiRequirement = useMemo(
    () => requirements.find((item) => item.id === aiRequirementId) || selectedRequirement || requirements[0] || null,
    [aiRequirementId, requirements, selectedRequirement]
  );

  const associatedCases = useMemo(() => {
    if (!aiRequirement) {
      return [];
    }

    const linkedIds = new Set(aiRequirement.test_case_ids || []);
    return testCases.filter((testCase) => linkedIds.has(testCase.id));
  }, [aiRequirement, testCases]);

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (selectedRequirement) {
      setSelectedRequirementId(selectedRequirement.id);
      setDraft({
        title: selectedRequirement.title,
        description: selectedRequirement.description || "",
        priority: selectedRequirement.priority ?? 3,
        status: selectedRequirement.status || "open"
      });
      setSelectedTestCaseIds(selectedRequirement.test_case_ids || []);
      return;
    }

    setSelectedRequirementId("");
    setDraft(EMPTY_REQUIREMENT);
    setSelectedTestCaseIds([]);
  }, [isCreating, selectedRequirement]);

  useEffect(() => {
    if (!aiRequirementId && selectedRequirement) {
      setAiRequirementId(selectedRequirement.id);
    }
  }, [aiRequirementId, selectedRequirement]);

  useEffect(() => {
    setSelectedTestCaseIds([]);
    setPreviewCases([]);
    setPreviewMessage("");
  }, [appTypeId]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["design-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["global-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["requirements-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-cases"] })
    ]);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      let requirementId = selectedRequirement?.id || "";

      if (isCreating || !selectedRequirement) {
        const response = await createRequirement.mutateAsync({
          project_id: projectId,
          title: draft.title,
          description: draft.description || undefined,
          priority: draft.priority,
          status: draft.status
        });
        requirementId = response.id;
        setIsCreating(false);
      } else {
        await updateRequirement.mutateAsync({
          id: selectedRequirement.id,
          input: {
            title: draft.title,
            description: draft.description,
            priority: draft.priority,
            status: draft.status
          }
        });
      }

      if (requirementId) {
        await replaceMappings.mutateAsync({ requirementId, testCaseIds: selectedTestCaseIds });
        setSelectedRequirementId(requirementId);
      }

      showSuccess(isCreating ? "Requirement created." : "Requirement updated.");
      await refresh();
    } catch (error) {
      showError(error, "Unable to save requirement");
    }
  };

  const handleDelete = async () => {
    if (!selectedRequirement || !window.confirm(`Delete requirement "${selectedRequirement.title}"? Linked test cases will remain in the library.`)) {
      return;
    }

    try {
      await deleteRequirement.mutateAsync(selectedRequirement.id);
      setSelectedRequirementId("");
      setDraft(EMPTY_REQUIREMENT);
      setSelectedTestCaseIds([]);
      setPreviewCases([]);
      showSuccess("Requirement deleted.");
      await refresh();
    } catch (error) {
      showError(error, "Unable to delete requirement");
    }
  };

  const handlePreviewDesignedCases = async () => {
    if (!aiRequirement || !appTypeId) {
      return;
    }

    try {
      const response = await previewDesignedCases.mutateAsync({
        requirementId: aiRequirement.id,
        input: {
          app_type_id: appTypeId,
          integration_id: integrationId || undefined,
          max_cases: maxCases
        }
      });

      setPreviewCases(
        response.cases.map((item) => ({
          client_id: item.client_id,
          title: item.title,
          description: item.description || "",
          priority: item.priority,
          step_count: item.step_count,
          steps: item.steps.map((step) => ({
            step_order: step.step_order,
            action: step.action || "",
            expected_result: step.expected_result || ""
          }))
        }))
      );
      setPreviewTone("success");
      setPreviewMessage(`${response.generated} draft cases generated using ${response.integration.name}. Review them before accepting.`);
    } catch (error) {
      setPreviewTone("error");
      setPreviewMessage(error instanceof Error ? error.message : "Unable to preview AI-generated test cases");
    }
  };

  const handleAcceptDesignedCases = async () => {
    if (!aiRequirement || !appTypeId || !previewCases.length) {
      return;
    }

    try {
      await acceptDesignedCases.mutateAsync({
        requirementId: aiRequirement.id,
        input: {
          app_type_id: appTypeId,
          status: "draft",
          cases: previewCases.map((item) => ({
            title: item.title,
            description: item.description,
            priority: item.priority,
            steps: item.steps.map((step) => ({
              step_order: step.step_order,
              action: step.action,
              expected_result: step.expected_result
            }))
          }))
        }
      });

      setIsAiStudioOpen(false);
      setPreviewCases([]);
      setPreviewMessage("");
      showSuccess("AI-designed cases accepted and linked to the requirement.");
      await refresh();
      navigate("/test-cases");
    } catch (error) {
      setPreviewTone("error");
      setPreviewMessage(error instanceof Error ? error.message : "Unable to accept AI-generated test cases");
    }
  };

  const metrics = useMemo(() => {
    const mapped = requirements.filter((item) => (item.test_case_ids || []).length).length;
    const highPriority = requirements.filter((item) => (item.priority || 3) <= 2).length;
    const open = requirements.filter((item) => (item.status || "open") !== "done").length;

    return {
      total: requirements.length,
      mapped,
      highPriority,
      open
    };
  }, [requirements]);

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Requirements"
        title="Requirements Workspace"
        description="Manage business intent separately from suite design, link reusable cases, and review AI-drafted cases before they become part of the central test case library."
        actions={
          <div className="page-actions">
            <button
              className="ghost-button"
              disabled={!requirements.length || !appTypeId}
              onClick={() => {
                setAiRequirementId(selectedRequirement?.id || requirements[0]?.id || "");
                setPreviewCases([]);
                setPreviewMessage("");
                setPreviewTone("success");
                setIsAiStudioOpen(true);
              }}
              type="button"
            >
              AI Design Studio
            </button>
            <button
              className="primary-button"
              onClick={() => {
                setIsCreating(true);
                setSelectedRequirementId("");
                setDraft(EMPTY_REQUIREMENT);
                setSelectedTestCaseIds([]);
              }}
              type="button"
            >
              + Create Requirement
            </button>
          </div>
        }
      />

      {message ? <p className={messageTone === "error" ? "inline-message error-message" : "inline-message success-message"}>{message}</p> : null}

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={setAppTypeId}
        onProjectChange={setProjectId}
        projectId={projectId}
        projects={projects}
      />

      <div className="metric-strip">
        <div className="mini-card">
          <strong>{metrics.total}</strong>
          <span>Total requirements</span>
        </div>
        <div className="mini-card">
          <strong>{metrics.mapped}</strong>
          <span>Mapped to test cases</span>
        </div>
        <div className="mini-card">
          <strong>{metrics.highPriority}</strong>
          <span>Priority 1-2 items</span>
        </div>
        <div className="mini-card">
          <strong>{metrics.open}</strong>
          <span>Still open or in progress</span>
        </div>
      </div>

      <div className="workspace-grid">
        <Panel title="Requirement list" subtitle="Select a requirement to refine details, manage links, or open the AI design studio.">
          <div className="record-list">
            {requirements.map((item) => (
              <button
                key={item.id}
                className={selectedRequirementId === item.id ? "record-card is-active" : "record-card"}
                onClick={() => {
                  setSelectedRequirementId(item.id);
                  setIsCreating(false);
                }}
                type="button"
              >
                <div className="record-card-body">
                  <div className="record-card-header">
                    <div className="record-card-icon requirement">RQ</div>
                    <strong>{item.title}</strong>
                  </div>
                  <span>{item.description || "No description"}</span>
                  <span>Priority {item.priority ?? "n/a"} · {item.status || "unset"}</span>
                </div>
                <span className="count-pill">{(item.test_case_ids || []).length}</span>
              </button>
            ))}
          </div>
          {!requirements.length ? <div className="empty-state compact">No requirements yet for this project.</div> : null}
        </Panel>

        <Panel title={isCreating ? "New requirement" : selectedRequirement ? "Requirement editor" : "Requirement editor"} subtitle="Keep the requirement sharp, then connect the reusable library cases that cover it.">
          {(isCreating || selectedRequirement) ? (
            <div className="detail-stack">
              <form className="form-grid" onSubmit={(event) => void handleSave(event)}>
                <div className="record-grid">
                  <FormField label="Title">
                    <input required value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
                  </FormField>
                  <FormField label="Status">
                    <input value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))} />
                  </FormField>
                  <FormField label="Priority">
                    <input min="1" max="5" type="number" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: Number(event.target.value) || 3 }))} />
                  </FormField>
                </div>
                <FormField label="Description">
                  <textarea rows={4} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
                </FormField>

                <div className="action-row">
                  <button className="primary-button" type="submit">{isCreating ? "Create requirement" : "Save requirement"}</button>
                  {!isCreating && selectedRequirement ? (
                    <button className="ghost-button danger" onClick={() => void handleDelete()} type="button">Delete requirement</button>
                  ) : null}
                </div>
              </form>

              <div className="panel-head">
                <div>
                  <h3>Linked test cases</h3>
                  <p>{appTypeId ? "Choose the reusable library cases that cover this requirement in the selected app type." : "Select an app type first."}</p>
                </div>
              </div>

              <div className="modal-case-picker">
                {testCases.map((testCase: TestCase) => (
                  <label className="modal-case-option" key={testCase.id}>
                    <input
                      checked={selectedTestCaseIds.includes(testCase.id)}
                      onChange={(event) => {
                        setSelectedTestCaseIds((current) =>
                          event.target.checked ? [...current, testCase.id] : current.filter((id) => id !== testCase.id)
                        );
                      }}
                      type="checkbox"
                    />
                    <span>{testCase.title}</span>
                  </label>
                ))}
                {!testCases.length ? <div className="empty-state compact">No test cases available for this app type.</div> : null}
              </div>
            </div>
          ) : (
            <div className="empty-state compact">Select a requirement from the left or create a new one.</div>
          )}
        </Panel>
      </div>

      {isAiStudioOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card ai-modal-card" role="dialog" aria-modal="true" aria-label="AI design studio">
            <div className="panel-head">
              <div>
                <h3>AI Design Studio</h3>
                <p>Select the requirement and LLM integration, review the proposed cases, remove any weak drafts, and then accept the remaining ones into the central test case library.</p>
              </div>
            </div>

            <div className="detail-stack">
              <div className="record-grid">
                <FormField label="Requirement">
                  <select value={aiRequirement?.id || ""} onChange={(event) => setAiRequirementId(event.target.value)}>
                    {requirements.map((requirement) => (
                      <option key={requirement.id} value={requirement.id}>{requirement.title}</option>
                    ))}
                  </select>
                </FormField>

                <FormField label="LLM integration">
                  <select value={integrationId} onChange={(event) => setIntegrationId(event.target.value)}>
                    <option value="">Default active integration</option>
                    {integrations.map((integration: Integration) => (
                      <option key={integration.id} value={integration.id}>
                        {integration.name}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Draft cases to generate">
                  <input min="1" max="20" type="number" value={maxCases} onChange={(event) => setMaxCases(Number(event.target.value) || 6)} />
                </FormField>
              </div>

              <div className="detail-summary">
                <strong>{appTypes.find((item) => item.id === appTypeId)?.name || "No app type selected"}</strong>
                <span>The current app type controls where accepted cases will be created.</span>
                <span>Associated test cases already linked to the selected requirement are shown below for quick comparison.</span>
              </div>

              {previewMessage ? <p className={previewTone === "error" ? "inline-message error-message" : "inline-message success-message"}>{previewMessage}</p> : null}

              {!integrations.length ? (
                <div className="inline-message error-message">
                  No active LLM integrations are available yet. Create one in Admin &gt; Integrations to use AI design.
                </div>
              ) : null}

              <div className="action-row">
                <button className="primary-button" disabled={!aiRequirement || !appTypeId || previewDesignedCases.isPending || !integrations.length} onClick={() => void handlePreviewDesignedCases()} type="button">
                  {previewDesignedCases.isPending ? "Designing…" : "Generate Preview"}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => {
                    setIsAiStudioOpen(false);
                    setPreviewCases([]);
                    setPreviewMessage("");
                  }}
                  type="button"
                >
                  Close
                </button>
              </div>

              <div className="ai-modal-grid">
                <div className="detail-stack">
                  <div className="panel-head">
                    <div>
                      <h3>Existing linked cases</h3>
                      <p>These are already associated with the selected requirement in the current app type.</p>
                    </div>
                  </div>

                  <div className="stack-list">
                    {associatedCases.map((testCase) => (
                      <div className="stack-item" key={testCase.id}>
                        <div>
                          <strong>{testCase.title}</strong>
                          <span>{testCase.description || "No description"}</span>
                        </div>
                        <span className="count-pill">Linked</span>
                      </div>
                    ))}
                    {!associatedCases.length ? <div className="empty-state compact">No associated cases yet for this requirement in the current app type.</div> : null}
                  </div>
                </div>

                <div className="detail-stack">
                  <div className="panel-head">
                    <div>
                      <h3>AI draft cases</h3>
                      <p>Remove any draft you do not want before accepting the rest into the system.</p>
                    </div>
                  </div>

                  <div className="ai-case-list">
                    {previewCases.map((item) => (
                      <article className="ai-case-card" key={item.client_id}>
                        <div className="step-card-top">
                          <div>
                            <strong>{item.title}</strong>
                            <span>Priority {item.priority} · {item.step_count} steps</span>
                          </div>
                          <button
                            className="ghost-button danger"
                            onClick={() => setPreviewCases((current) => current.filter((candidate) => candidate.client_id !== item.client_id))}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                        <span>{item.description || "No description generated."}</span>
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

              <div className="action-row">
                <button className="primary-button" disabled={!previewCases.length || acceptDesignedCases.isPending} onClick={() => void handleAcceptDesignedCases()} type="button">
                  {acceptDesignedCases.isPending ? "Accepting…" : "Accept And Move To Test Cases"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
