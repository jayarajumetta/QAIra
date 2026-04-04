import { Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ToastMessage } from "../components/ToastMessage";
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
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [draft, setDraft] = useState<RequirementDraft>(EMPTY_REQUIREMENT);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<RequirementDraft>(EMPTY_REQUIREMENT);
  const [createSelectedTestCaseIds, setCreateSelectedTestCaseIds] = useState<string[]>([]);
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

  useEffect(() => {
    if (!requirements.length) {
      if (selectedRequirementId) {
        setSelectedRequirementId("");
      }
      return;
    }

    if (!selectedRequirementId || !requirements.some((item) => item.id === selectedRequirementId)) {
      setSelectedRequirementId(requirements[0].id);
    }
  }, [requirements, selectedRequirementId]);

  const selectedRequirement = useMemo(
    () => requirements.find((item) => item.id === selectedRequirementId) || requirements[0] || null,
    [requirements, selectedRequirementId]
  );

  const aiRequirement = useMemo(
    () => requirements.find((item) => item.id === aiRequirementId) || selectedRequirement || requirements[0] || null,
    [aiRequirementId, requirements, selectedRequirement]
  );

  const currentAppTypeName = appTypes.find((item) => item.id === appTypeId)?.name || "No app type selected";

  const associatedCases = useMemo(() => {
    if (!aiRequirement) {
      return [];
    }

    const linkedIds = new Set(aiRequirement.test_case_ids || []);
    return testCases.filter((testCase) => linkedIds.has(testCase.id));
  }, [aiRequirement, testCases]);

  const selectedVisibleCases = useMemo(() => {
    if (!selectedRequirement) {
      return [];
    }

    const linkedIds = new Set(selectedRequirement.test_case_ids || []);
    return testCases.filter((testCase) => linkedIds.has(testCase.id));
  }, [selectedRequirement, testCases]);

  useEffect(() => {
    if (!selectedRequirement) {
      setDraft(EMPTY_REQUIREMENT);
      setSelectedTestCaseIds([]);
      return;
    }

    setDraft({
      title: selectedRequirement.title,
      description: selectedRequirement.description || "",
      priority: selectedRequirement.priority ?? 3,
      status: selectedRequirement.status || "open"
    });
    setSelectedTestCaseIds(selectedRequirement.test_case_ids || []);
  }, [selectedRequirement]);

  useEffect(() => {
    if (!aiRequirementId && selectedRequirement) {
      setAiRequirementId(selectedRequirement.id);
    }
  }, [aiRequirementId, selectedRequirement]);

  useEffect(() => {
    if (!isCreateModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createRequirement.isPending && !replaceMappings.isPending) {
        setIsCreateModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [createRequirement.isPending, isCreateModalOpen, replaceMappings.isPending]);

  useEffect(() => {
    if (!isCreateModalOpen) {
      return;
    }

    setCreateSelectedTestCaseIds((current) => current.filter((id) => testCases.some((testCase) => testCase.id === id)));
  }, [isCreateModalOpen, testCases]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["requirements-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-cases"] })
    ]);
  };

  const openCreateRequirementModal = () => {
    setCreateDraft(EMPTY_REQUIREMENT);
    setCreateSelectedTestCaseIds([]);
    setIsCreateModalOpen(true);
  };

  const closeCreateRequirementModal = () => {
    if (createRequirement.isPending || replaceMappings.isPending) {
      return;
    }

    setIsCreateModalOpen(false);
  };

  const toggleSelectedTestCase = (
    setter: Dispatch<SetStateAction<string[]>>,
    testCaseId: string,
    checked: boolean
  ) => {
    setter((current) => (checked ? [...new Set([...current, testCaseId])] : current.filter((id) => id !== testCaseId)));
  };

  const handleCreateRequirement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!projectId) {
      showError(null, "Select a project before creating a requirement.");
      return;
    }

    try {
      const response = await createRequirement.mutateAsync({
        project_id: projectId,
        title: createDraft.title,
        description: createDraft.description || undefined,
        priority: createDraft.priority,
        status: createDraft.status
      });

      if (createSelectedTestCaseIds.length) {
        await replaceMappings.mutateAsync({ requirementId: response.id, testCaseIds: createSelectedTestCaseIds });
      }

      setSelectedRequirementId(response.id);
      setAiRequirementId(response.id);
      setIsCreateModalOpen(false);
      setCreateDraft(EMPTY_REQUIREMENT);
      setCreateSelectedTestCaseIds([]);
      showSuccess("Requirement created.");
      await refresh();
    } catch (error) {
      showError(error, "Unable to create requirement");
    }
  };

  const handleSaveRequirement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedRequirement) {
      return;
    }

    try {
      await updateRequirement.mutateAsync({
        id: selectedRequirement.id,
        input: {
          title: draft.title,
          description: draft.description,
          priority: draft.priority,
          status: draft.status
        }
      });

      await replaceMappings.mutateAsync({ requirementId: selectedRequirement.id, testCaseIds: selectedTestCaseIds });
      showSuccess("Requirement updated.");
      await refresh();
    } catch (error) {
      showError(error, "Unable to update requirement");
    }
  };

  const handleDeleteRequirement = async () => {
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
            <button className="primary-button" disabled={!projectId} onClick={openCreateRequirementModal} type="button">
              Create Requirement
            </button>
          </div>
        }
      />

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

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

      <div className="requirement-workspace">
        <div className="requirement-sidebar">
          <Panel title="Requirement catalog" subtitle="Select a requirement card to review its details, adjust coverage links, or send it into the AI design studio.">
            <div className="record-list requirement-card-list">
              {requirements.map((item) => (
                <button
                  key={item.id}
                  className={selectedRequirement?.id === item.id ? "record-card tile-card requirement-catalog-card is-active" : "record-card tile-card requirement-catalog-card"}
                  onClick={() => setSelectedRequirementId(item.id)}
                  type="button"
                >
                  <div className="tile-card-main">
                    <div className="tile-card-header">
                      <div className="record-card-icon requirement-card-icon">RQ</div>
                      <div className="tile-card-title-group">
                        <strong>{item.title}</strong>
                        <span className="tile-card-kicker">{item.status || "open"} · Priority P{item.priority ?? 3}</span>
                      </div>
                      <span className="object-type-badge">REQUIREMENT</span>
                    </div>
                    <p className="tile-card-description">{item.description || "No description yet."}</p>
                    <div className="tile-card-metrics">
                      <span className="tile-metric">{(item.test_case_ids || []).length} linked cases</span>
                      <span className="tile-metric">{currentAppTypeName}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {!requirements.length ? <div className="empty-state compact">No requirements yet for this project.</div> : null}
          </Panel>
        </div>

        <div className="requirement-detail-column">
          <Panel title={selectedRequirement ? selectedRequirement.title : "Requirement details"} subtitle={selectedRequirement ? "Edit the requirement, manage reusable coverage links, and keep the selected item in focus." : "Select a requirement to review its details."}>
            {selectedRequirement ? (
              <div className="detail-stack">
                <div className="detail-summary">
                  <strong>{selectedRequirement.title}</strong>
                  <span>{selectedRequirement.description || "No description yet for this requirement."}</span>
                  <span>{currentAppTypeName} · {(selectedRequirement.test_case_ids || []).length} linked case{(selectedRequirement.test_case_ids || []).length === 1 ? "" : "s"} across the workspace</span>
                </div>

                <div className="metric-strip">
                  <div className="mini-card">
                    <strong>P{draft.priority || 3}</strong>
                    <span>Priority</span>
                  </div>
                  <div className="mini-card">
                    <strong>{draft.status || "open"}</strong>
                    <span>Status</span>
                  </div>
                  <div className="mini-card">
                    <strong>{selectedTestCaseIds.length}</strong>
                    <span>Total linked cases</span>
                  </div>
                  <div className="mini-card">
                    <strong>{selectedVisibleCases.length}</strong>
                    <span>Visible in current app type</span>
                  </div>
                </div>

                <form className="form-grid" onSubmit={(event) => void handleSaveRequirement(event)}>
                  <div className="record-grid">
                    <FormField label="Title" required>
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
                    <button className="primary-button" disabled={updateRequirement.isPending || replaceMappings.isPending} type="submit">
                      {updateRequirement.isPending || replaceMappings.isPending ? "Saving…" : "Save requirement"}
                    </button>
                    <button className="ghost-button danger" disabled={deleteRequirement.isPending} onClick={() => void handleDeleteRequirement()} type="button">
                      Delete requirement
                    </button>
                  </div>
                </form>

                <section className="requirement-link-section">
                  <div className="panel-head">
                    <div>
                      <h3>Link or unlink existing test cases</h3>
                      <p>Choose the reusable cases from the selected app type that cover this requirement. Hidden links from other app types stay intact unless you change them elsewhere.</p>
                    </div>
                  </div>

                  <div className="detail-summary">
                    <strong>{selectedTestCaseIds.length} linked case{selectedTestCaseIds.length === 1 ? "" : "s"}</strong>
                    <span>{appTypeId ? `Currently browsing reusable cases for ${currentAppTypeName}.` : "Select an app type first to manage linked coverage."}</span>
                  </div>

                  <div className="stack-list">
                    {selectedVisibleCases.map((testCase) => (
                      <div className="stack-item" key={testCase.id}>
                        <div>
                          <strong>{testCase.title}</strong>
                          <span>{testCase.description || "No description available."}</span>
                        </div>
                        <span className="count-pill">Linked</span>
                      </div>
                    ))}
                    {!selectedVisibleCases.length ? <div className="empty-state compact">No linked test cases are visible in the current app type yet.</div> : null}
                  </div>

                  <RequirementTestCasePicker
                    emptyText={appTypeId ? "No reusable test cases are available for this app type." : "Select an app type first to link reusable test cases."}
                    selectedIds={selectedTestCaseIds}
                    testCases={testCases}
                    onToggle={(testCaseId, checked) => toggleSelectedTestCase(setSelectedTestCaseIds, testCaseId, checked)}
                  />
                </section>
              </div>
            ) : (
              <div className="empty-state compact">Select a requirement from the catalog to view and edit its details.</div>
            )}
          </Panel>
        </div>
      </div>

      {isCreateModalOpen ? (
        <div className="modal-backdrop" onClick={closeCreateRequirementModal}>
          <div
            aria-labelledby="create-requirement-title"
            aria-modal="true"
            className="modal-card requirement-create-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="requirement-create-header">
              <div className="requirement-create-title">
                <p className="eyebrow">Requirements</p>
                <h3 id="create-requirement-title">Create requirement</h3>
                <p>Create the requirement in a focused modal, then link any reusable test cases that already exist for the selected app type.</p>
              </div>
              <button className="ghost-button" disabled={createRequirement.isPending || replaceMappings.isPending} onClick={closeCreateRequirementModal} type="button">
                Close
              </button>
            </div>

            <form className="requirement-create-modal-form" onSubmit={(event) => void handleCreateRequirement(event)}>
              <div className="requirement-create-modal-body">
                <div className="form-grid">
                  <FormField label="Title" inputId="create-requirement-title-input" required>
                    <input
                      autoFocus
                      id="create-requirement-title-input"
                      required
                      value={createDraft.title}
                      onChange={(event) => setCreateDraft((current) => ({ ...current, title: event.target.value }))}
                    />
                  </FormField>
                  <div className="record-grid">
                    <FormField label="Status">
                      <input
                        value={createDraft.status}
                        onChange={(event) => setCreateDraft((current) => ({ ...current, status: event.target.value }))}
                      />
                    </FormField>
                    <FormField label="Priority">
                      <input
                        min="1"
                        max="5"
                        type="number"
                        value={createDraft.priority}
                        onChange={(event) => setCreateDraft((current) => ({ ...current, priority: Number(event.target.value) || 3 }))}
                      />
                    </FormField>
                  </div>
                  <FormField label="Description" inputId="create-requirement-description-input">
                    <textarea
                      id="create-requirement-description-input"
                      rows={4}
                      value={createDraft.description}
                      onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))}
                    />
                  </FormField>
                </div>

                <div className="metric-strip compact">
                  <div className="mini-card">
                    <strong>{createSelectedTestCaseIds.length}</strong>
                    <span>Linked test cases</span>
                  </div>
                  <div className="mini-card">
                    <strong>{currentAppTypeName}</strong>
                    <span>Coverage source</span>
                  </div>
                </div>

                <div className="detail-summary">
                  <strong>Link reusable test cases while creating</strong>
                  <span>Use the selector below to attach existing test cases now. You can always link or unlink more later from the selected requirement details.</span>
                </div>

                <section className="requirement-link-section">
                  <div className="panel-head">
                    <div>
                      <h3>Existing test cases</h3>
                      <p>{appTypeId ? `Select reusable cases from ${currentAppTypeName} to link immediately.` : "Select an app type first to link existing reusable test cases."}</p>
                    </div>
                  </div>

                  <RequirementTestCasePicker
                    emptyText={appTypeId ? "No reusable test cases are available for this app type." : "Select an app type first to link reusable test cases."}
                    selectedIds={createSelectedTestCaseIds}
                    testCases={testCases}
                    onToggle={(testCaseId, checked) => toggleSelectedTestCase(setCreateSelectedTestCaseIds, testCaseId, checked)}
                  />
                </section>
              </div>

              <div className="action-row requirement-create-modal-actions">
                <button className="ghost-button" disabled={createRequirement.isPending || replaceMappings.isPending} onClick={closeCreateRequirementModal} type="button">
                  Cancel
                </button>
                <button className="primary-button" disabled={createRequirement.isPending || replaceMappings.isPending} type="submit">
                  {createRequirement.isPending || replaceMappings.isPending ? "Creating…" : "Create requirement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isAiStudioOpen ? (
        <div className="modal-backdrop" onClick={() => setIsAiStudioOpen(false)} role="presentation">
          <div className="modal-card ai-modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="AI design studio">
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
                <strong>{currentAppTypeName}</strong>
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

function RequirementTestCasePicker({
  testCases,
  selectedIds,
  onToggle,
  emptyText
}: {
  testCases: TestCase[];
  selectedIds: string[];
  onToggle: (testCaseId: string, checked: boolean) => void;
  emptyText: string;
}) {
  if (!testCases.length) {
    return <div className="empty-state compact">{emptyText}</div>;
  }

  return (
    <div className="modal-case-picker requirement-link-picker">
      {testCases.map((testCase) => (
        <label className="modal-case-option requirement-link-option" key={testCase.id}>
          <input
            checked={selectedIds.includes(testCase.id)}
            onChange={(event) => onToggle(testCase.id, event.target.checked)}
            type="checkbox"
          />
          <div>
            <strong>{testCase.title}</strong>
            <span>{testCase.description || "No description available."}</span>
            <span className="requirement-link-option-meta">
              Priority P{testCase.priority ?? 3} · {testCase.status || "draft"}
            </span>
          </div>
        </label>
      ))}
    </div>
  );
}
