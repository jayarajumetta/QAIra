import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { api } from "../lib/api";
import type { Requirement, TestCase } from "../types";

type RequirementDraft = {
  title: string;
  description: string;
  priority: number;
  status: string;
};

const EMPTY_REQUIREMENT: RequirementDraft = {
  title: "",
  description: "",
  priority: 3,
  status: "open"
};

export function RequirementsPage() {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [appTypeId, setAppTypeId] = useState("");
  const [selectedRequirementId, setSelectedRequirementId] = useState("");
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<RequirementDraft>(EMPTY_REQUIREMENT);

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

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const requirements = requirementsQuery.data || [];
  const testCases = testCasesQuery.data || [];

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

  const selectedRequirement = useMemo(
    () => requirements.find((item) => item.id === selectedRequirementId) || requirements[0] || null,
    [requirements, selectedRequirementId]
  );

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
    setSelectedTestCaseIds([]);
  }, [appTypeId]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["design-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["global-test-cases", appTypeId] }),
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

      setMessage(isCreating ? "Requirement created." : "Requirement updated.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save requirement");
    }
  };

  const handleDelete = async () => {
    if (!selectedRequirement || !window.confirm(`Delete requirement "${selectedRequirement.title}"?`)) {
      return;
    }

    try {
      await deleteRequirement.mutateAsync(selectedRequirement.id);
      setSelectedRequirementId("");
      setDraft(EMPTY_REQUIREMENT);
      setSelectedTestCaseIds([]);
      setMessage("Requirement deleted.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete requirement");
    }
  };

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Requirements"
        title="Requirements"
        description="Keep business requirements in their own workspace, then map them to test cases without crowding the design editor."
        actions={
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
        }
      />

      {message ? <p className="inline-message success-message">{message}</p> : null}

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={setAppTypeId}
        onProjectChange={setProjectId}
        projectId={projectId}
        projects={projects}
      />

      <div className="workspace-grid">
        <Panel title="Requirement list" subtitle="Select a requirement to edit its details and linked test cases.">
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
                  <strong>{item.title}</strong>
                  <span>{item.description || "No description"}</span>
                  <span>Priority {item.priority ?? "n/a"} · {item.status || "unset"}</span>
                </div>
                <span className="count-pill">{(item.test_case_ids || []).length}</span>
              </button>
            ))}
          </div>
          {!requirements.length ? <div className="empty-state compact">No requirements yet for this project.</div> : null}
        </Panel>

        <Panel title={isCreating ? "New requirement" : selectedRequirement ? "Selected requirement" : "Requirement editor"} subtitle="Edit details and choose the test cases this requirement should cover.">
          {(isCreating || selectedRequirement) ? (
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

              <div className="panel-head">
                <div>
                  <h3>Linked Test Cases</h3>
                  <p>{appTypeId ? "Choose the cases this requirement should cover in the selected app type." : "Select an app type first."}</p>
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

              <div className="action-row">
                <button className="primary-button" type="submit">{isCreating ? "Create requirement" : "Save requirement"}</button>
                {!isCreating && selectedRequirement ? (
                  <button className="ghost-button danger" onClick={() => void handleDelete()} type="button">Delete requirement</button>
                ) : null}
              </div>
            </form>
          ) : (
            <div className="empty-state compact">Select a requirement from the left or create a new one.</div>
          )}
        </Panel>
      </div>
    </div>
  );
}
