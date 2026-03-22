import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { api } from "../lib/api";
import type { ExecutionResult, Requirement, TestCase, TestStep } from "../types";

type TestCaseDraft = {
  title: string;
  description: string;
  priority: number;
  status: string;
  requirement_id: string;
};

type StepDraft = {
  action: string;
  expected_result: string;
};

const EMPTY_CASE_DRAFT: TestCaseDraft = {
  title: "",
  description: "",
  priority: 3,
  status: "active",
  requirement_id: ""
};

const EMPTY_STEP_DRAFT: StepDraft = {
  action: "",
  expected_result: ""
};

export function TestCasesPage() {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [appTypeId, setAppTypeId] = useState("");
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [caseDraft, setCaseDraft] = useState<TestCaseDraft>(EMPTY_CASE_DRAFT);
  const [newStepDraft, setNewStepDraft] = useState<StepDraft>(EMPTY_STEP_DRAFT);

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
    queryKey: ["global-test-cases", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const executionResultsQuery = useQuery({
    queryKey: ["global-test-case-results", appTypeId],
    queryFn: () => api.executionResults.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const stepsQuery = useQuery({
    queryKey: ["test-case-steps", selectedTestCaseId],
    queryFn: () => api.testSteps.list({ test_case_id: selectedTestCaseId }),
    enabled: Boolean(selectedTestCaseId)
  });

  const createTestCase = useMutation({ mutationFn: api.testCases.create });
  const updateTestCase = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testCases.update>[1] }) =>
      api.testCases.update(id, input)
  });
  const deleteTestCase = useMutation({ mutationFn: api.testCases.delete });
  const createStep = useMutation({ mutationFn: api.testSteps.create });
  const updateStep = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testSteps.update>[1] }) =>
      api.testSteps.update(id, input)
  });
  const deleteStep = useMutation({ mutationFn: api.testSteps.delete });

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const requirements = requirementsQuery.data || [];
  const testCases = testCasesQuery.data || [];
  const executionResults = executionResultsQuery.data || [];
  const steps = useMemo(
    () => ((stepsQuery.data || []) as TestStep[]).slice().sort((left, right) => left.step_order - right.step_order),
    [stepsQuery.data]
  );

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
    setSelectedTestCaseId("");
    setIsCreating(false);
    setCaseDraft(EMPTY_CASE_DRAFT);
    setNewStepDraft(EMPTY_STEP_DRAFT);
  }, [appTypeId]);

  const historyByCaseId = useMemo(() => {
    const map: Record<string, ExecutionResult[]> = {};

    executionResults.forEach((result) => {
      map[result.test_case_id] = map[result.test_case_id] || [];
      map[result.test_case_id].push(result);
    });

    Object.values(map).forEach((items) => {
      items.sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
    });

    return map;
  }, [executionResults]);

  const filteredCases = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return testCases.filter((testCase) => {
      if (!search) {
        return true;
      }

      return [
        testCase.title,
        testCase.description || "",
        requirements.find((item) => item.id === testCase.requirement_id)?.title || ""
      ].some((value) => value.toLowerCase().includes(search));
    });
  }, [requirements, searchTerm, testCases]);

  const selectedTestCase = useMemo(
    () => filteredCases.find((item) => item.id === selectedTestCaseId) || testCases.find((item) => item.id === selectedTestCaseId) || null,
    [filteredCases, selectedTestCaseId, testCases]
  );

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (selectedTestCase) {
      setSelectedTestCaseId(selectedTestCase.id);
      setCaseDraft({
        title: selectedTestCase.title,
        description: selectedTestCase.description || "",
        priority: selectedTestCase.priority ?? 3,
        status: selectedTestCase.status || "active",
        requirement_id: selectedTestCase.requirement_ids?.[0] || selectedTestCase.requirement_id || ""
      });
      return;
    }

    if (filteredCases[0]) {
      setSelectedTestCaseId(filteredCases[0].id);
      return;
    }

    setSelectedTestCaseId("");
    setCaseDraft(EMPTY_CASE_DRAFT);
  }, [filteredCases, isCreating, selectedTestCase]);

  useEffect(() => {
    setNewStepDraft(EMPTY_STEP_DRAFT);
  }, [selectedTestCaseId]);

  const refreshCases = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["global-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["global-test-case-results", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] }),
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["design-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-cases"] })
    ]);
  };

  const handleSaveCase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      if (isCreating) {
        const response = await createTestCase.mutateAsync({
          title: caseDraft.title,
          description: caseDraft.description || undefined,
          priority: Number(caseDraft.priority),
          status: caseDraft.status,
          requirement_ids: caseDraft.requirement_id ? [caseDraft.requirement_id] : [],
          suite_ids: []
        });

        setSelectedTestCaseId(response.id);
        setIsCreating(false);
        setMessage("Test case created.");
      } else if (selectedTestCase) {
        await updateTestCase.mutateAsync({
          id: selectedTestCase.id,
          input: {
            title: caseDraft.title,
            description: caseDraft.description,
            priority: Number(caseDraft.priority),
            status: caseDraft.status,
            requirement_ids: caseDraft.requirement_id ? [caseDraft.requirement_id] : []
          }
        });

        setMessage("Test case updated.");
      }

      await refreshCases();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save test case");
    }
  };

  const handleDeleteCase = async () => {
    if (!selectedTestCase || !window.confirm(`Delete test case "${selectedTestCase.title}"?`)) {
      return;
    }

    try {
      await deleteTestCase.mutateAsync(selectedTestCase.id);
      setSelectedTestCaseId("");
      setCaseDraft(EMPTY_CASE_DRAFT);
      setIsCreating(false);
      setMessage("Test case deleted.");
      await refreshCases();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete test case");
    }
  };

  const handleCreateStep = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedTestCaseId) {
      return;
    }

    try {
      await createStep.mutateAsync({
        test_case_id: selectedTestCaseId,
        step_order: steps.length + 1,
        action: newStepDraft.action || undefined,
        expected_result: newStepDraft.expected_result || undefined
      });
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setMessage("Step added.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add step");
    }
  };

  const handleUpdateStep = async (step: TestStep, input: StepDraft) => {
    try {
      await updateStep.mutateAsync({
        id: step.id,
        input: {
          action: input.action,
          expected_result: input.expected_result
        }
      });
      setMessage("Step updated.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update step");
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!window.confirm("Delete this step?")) {
      return;
    }

    try {
      await deleteStep.mutateAsync(stepId);
      setMessage("Step deleted.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete step");
    }
  };

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Test Cases"
        title="Test Cases"
        description="Browse all test cases for one app type, compare recent execution outcomes, and edit the selected case without jumping back into suites."
        actions={
          <button
            className="primary-button"
            onClick={() => {
              setIsCreating(true);
              setSelectedTestCaseId("");
              setCaseDraft(EMPTY_CASE_DRAFT);
            }}
            type="button"
          >
            + New Test Case
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
        <Panel title="Test case list" subtitle={appTypeId ? "Execution bars show the latest run history for each case." : "Choose an app type to begin."}>
          <div className="design-list-toolbar">
            <input
              placeholder="Search title, description, or requirement"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>

          {testCasesQuery.isLoading || executionResultsQuery.isLoading ? (
            <div className="record-list">
              <div className="skeleton-block" />
              <div className="skeleton-block" />
              <div className="skeleton-block" />
            </div>
          ) : null}
          {!testCasesQuery.isLoading && !filteredCases.length ? <div className="empty-state compact">No test cases found for this app type.</div> : null}

          <div className="record-list">
            {filteredCases.map((testCase: TestCase) => {
              const history = (historyByCaseId[testCase.id] || []).slice(0, 10);
              const latest = history[0];
              const requirement = requirements.find((item) => (testCase.requirement_ids || [testCase.requirement_id]).includes(item.id));

              return (
                <button
                  className={selectedTestCaseId === testCase.id ? "record-card is-active" : "record-card"}
                  key={testCase.id}
                  onClick={() => {
                    setSelectedTestCaseId(testCase.id);
                    setIsCreating(false);
                  }}
                  type="button"
                >
                  <div className="record-card-body">
                    <strong>{testCase.title}</strong>
                    <span>{testCase.description || "No description"}</span>
                    <span>{requirement?.title || "No requirement linked"}</span>
                    <div className="history-bars" aria-label="Execution history">
                      {history.length ? history.map((result) => (
                        <span
                          key={result.id}
                          className={result.status === "passed" ? "history-bar is-passed" : result.status === "failed" ? "history-bar is-failed" : "history-bar is-blocked"}
                          title={`${result.status} · ${result.created_at || "recent"}`}
                        />
                      )) : <span className="history-bar" />}
                    </div>
                  </div>
                  <StatusBadge value={latest?.status || testCase.status || "active"} />
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title={isCreating ? "New test case" : selectedTestCase ? "Selected test case" : "Test case editor"} subtitle={selectedTestCaseId || isCreating ? "Edit metadata, requirement link, and steps from one panel." : "Select a test case or create a new one."}>
          {selectedTestCaseId || isCreating ? (
            <div className="detail-stack">
              <form className="form-grid" onSubmit={(event) => void handleSaveCase(event)}>
                <div className="record-grid">
                  <FormField label="Title">
                    <input
                      required
                      value={caseDraft.title}
                      onChange={(event) => setCaseDraft((current) => ({ ...current, title: event.target.value }))}
                    />
                  </FormField>
                  <FormField label="Status">
                    <select
                      value={caseDraft.status}
                      onChange={(event) => setCaseDraft((current) => ({ ...current, status: event.target.value }))}
                    >
                      <option value="active">active</option>
                      <option value="draft">draft</option>
                      <option value="retired">retired</option>
                    </select>
                  </FormField>
                  <FormField label="Requirement">
                    <select
                      value={caseDraft.requirement_id}
                      onChange={(event) => setCaseDraft((current) => ({ ...current, requirement_id: event.target.value }))}
                    >
                      <option value="">No requirement</option>
                      {requirements.map((requirement: Requirement) => (
                        <option key={requirement.id} value={requirement.id}>{requirement.title}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Priority">
                    <input
                      min="1"
                      max="5"
                      type="number"
                      value={caseDraft.priority}
                      onChange={(event) => setCaseDraft((current) => ({ ...current, priority: Number(event.target.value) || 3 }))}
                    />
                  </FormField>
                </div>
                <FormField label="Description">
                  <textarea
                    rows={4}
                    value={caseDraft.description}
                    onChange={(event) => setCaseDraft((current) => ({ ...current, description: event.target.value }))}
                  />
                </FormField>

                <div className="action-row">
                  <button className="primary-button" type="submit">{isCreating ? "Create test case" : "Save test case"}</button>
                  {!isCreating && selectedTestCase ? (
                    <button className="ghost-button danger" onClick={() => void handleDeleteCase()} type="button">
                      Delete test case
                    </button>
                  ) : null}
                </div>
              </form>

              {!isCreating ? (
                <div className="step-editor">
                  <div className="panel-head">
                    <h3>Steps</h3>
                    <p>Steps are lazy-loaded only for the selected test case.</p>
                  </div>

                  {stepsQuery.isLoading ? <div className="empty-state compact">Loading steps…</div> : null}
                  {!stepsQuery.isLoading && !steps.length ? <div className="empty-state compact">No steps yet for this test case.</div> : null}

                  <div className="step-list">
                    {steps.map((step) => (
                      <EditableStepCard
                        key={step.id}
                        onDelete={() => void handleDeleteStep(step.id)}
                        onSave={(input) => void handleUpdateStep(step, input)}
                        step={step}
                      />
                    ))}
                  </div>

                  <form className="step-create" onSubmit={(event) => void handleCreateStep(event)}>
                    <strong>+ Add Step</strong>
                    <FormField label="Action">
                      <input
                        value={newStepDraft.action}
                        onChange={(event) => setNewStepDraft((current) => ({ ...current, action: event.target.value }))}
                      />
                    </FormField>
                    <FormField label="Expected result">
                      <textarea
                        rows={3}
                        value={newStepDraft.expected_result}
                        onChange={(event) => setNewStepDraft((current) => ({ ...current, expected_result: event.target.value }))}
                      />
                    </FormField>
                    <button className="primary-button" type="submit">Add step</button>
                  </form>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty-state compact">Select a test case from the left, or start a new one for this app type.</div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function EditableStepCard({
  step,
  onSave,
  onDelete
}: {
  step: TestStep;
  onSave: (input: StepDraft) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<StepDraft>({
    action: step.action || "",
    expected_result: step.expected_result || ""
  });

  useEffect(() => {
    setDraft({
      action: step.action || "",
      expected_result: step.expected_result || ""
    });
  }, [step.action, step.expected_result, step.id]);

  return (
    <article className="step-card is-expanded">
      <div className="step-card-top">
        <div>
          <strong>Step {step.step_order}</strong>
          <span>Inline editor</span>
        </div>
      </div>
      <div className="step-card-body">
        <FormField label="Action">
          <input value={draft.action} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))} />
        </FormField>
        <FormField label="Expected result">
          <textarea rows={3} value={draft.expected_result} onChange={(event) => setDraft((current) => ({ ...current, expected_result: event.target.value }))} />
        </FormField>
        <div className="action-row">
          <button className="primary-button" onClick={() => onSave(draft)} type="button">Save step</button>
          <button className="ghost-button danger" onClick={onDelete} type="button">Delete step</button>
        </div>
      </div>
    </article>
  );
}
