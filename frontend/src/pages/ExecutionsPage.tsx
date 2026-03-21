import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import type { AppType, Execution, ExecutionResult, Project, TestCase, TestStep, TestSuite } from "../types";

type StepStatus = "passed" | "failed" | "blocked";

export function ExecutionsPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [projectId, setProjectId] = useState("");
  const [appTypeId, setAppTypeId] = useState("");
  const [selectedSuiteIds, setSelectedSuiteIds] = useState<string[]>([]);
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const [expandedSuiteIds, setExpandedSuiteIds] = useState<string[]>([]);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [executionName, setExecutionName] = useState("");
  const [message, setMessage] = useState("");

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list
  });
  const executionsQuery = useQuery({
    queryKey: ["executions", projectId],
    queryFn: () => api.executions.list(projectId ? { project_id: projectId } : undefined)
  });
  const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: () => api.appTypes.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const scopedSuitesQuery = useQuery({
    queryKey: ["execution-suites", appTypeId],
    queryFn: () => api.testSuites.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const executionResultsQuery = useQuery({
    queryKey: ["execution-results", selectedExecutionId],
    queryFn: () => api.executionResults.list({ execution_id: selectedExecutionId }),
    enabled: Boolean(selectedExecutionId)
  });

  const createExecution = useMutation({ mutationFn: api.executions.create });
  const startExecution = useMutation({ mutationFn: api.executions.start });
  const completeExecution = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "completed" | "failed" }) => api.executions.complete(id, { status })
  });
  const createResult = useMutation({ mutationFn: api.executionResults.create });
  const updateResult = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ status: ExecutionResult["status"]; duration_ms: number; error: string; logs: string }> }) =>
      api.executionResults.update(id, input)
  });

  const projects = projectsQuery.data || [];
  const executions = executionsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const scopeSuites = scopedSuitesQuery.data || [];
  const executionResults = executionResultsQuery.data || [];

  useEffect(() => {
    if (!projectId && projects[0]) {
      setProjectId(projects[0].id);
    }
  }, [projectId, projects]);

  useEffect(() => {
    if (!appTypes.length) {
      setAppTypeId("");
      setSelectedSuiteIds([]);
      return;
    }

    if (!appTypes.some((item) => item.id === appTypeId)) {
      setAppTypeId(appTypes[0].id);
      setSelectedSuiteIds([]);
    }
  }, [appTypeId, appTypes]);

  const selectedExecution = executions.find((execution) => execution.id === selectedExecutionId) || executions[0] || null;

  useEffect(() => {
    if (selectedExecution && selectedExecution.id !== selectedExecutionId) {
      setSelectedExecutionId(selectedExecution.id);
    }
    if (!selectedExecution) {
      setSelectedExecutionId("");
    }
  }, [selectedExecution, selectedExecutionId]);

  const executionAppTypeId = selectedExecution?.app_type_id || "";
  const executionSuitesQuery = useQuery({
    queryKey: ["execution-tree-suites", executionAppTypeId],
    queryFn: () => api.testSuites.list({ app_type_id: executionAppTypeId }),
    enabled: Boolean(executionAppTypeId)
  });

  const executionSuites = useMemo(() => {
    const allSuites = executionSuitesQuery.data || [];
    const suiteIds = new Set(selectedExecution?.suite_ids || []);
    return allSuites.filter((suite) => suiteIds.has(suite.id));
  }, [executionSuitesQuery.data, selectedExecution?.suite_ids]);

  useEffect(() => {
    setExpandedSuiteIds((current) => current.filter((id) => executionSuites.some((suite) => suite.id === id)));
  }, [executionSuites]);

  const caseQueries = useQueries({
    queries: executionSuites.map((suite) => ({
      queryKey: ["execution-suite-cases", suite.id],
      queryFn: () => api.testCases.list({ suite_id: suite.id }),
      enabled: expandedSuiteIds.includes(suite.id)
    }))
  });

  const casesBySuiteId = useMemo(() => {
    const map: Record<string, TestCase[]> = {};
    executionSuites.forEach((suite, index) => {
      map[suite.id] = (caseQueries[index]?.data as TestCase[] | undefined) || [];
    });
    return map;
  }, [caseQueries, executionSuites]);

  const executionCaseOrder = useMemo(() => {
    const ordered: TestCase[] = [];
    executionSuites.forEach((suite) => {
      (casesBySuiteId[suite.id] || []).forEach((testCase) => ordered.push(testCase));
    });
    return ordered;
  }, [casesBySuiteId, executionSuites]);

  useEffect(() => {
    if (selectedTestCaseId && executionCaseOrder.some((testCase) => testCase.id === selectedTestCaseId)) {
      return;
    }

    const firstAvailable = executionSuites
      .map((suite) => casesBySuiteId[suite.id]?.[0])
      .find(Boolean);

    setSelectedTestCaseId(firstAvailable?.id || "");
  }, [casesBySuiteId, executionCaseOrder, executionSuites, selectedTestCaseId]);

  const stepsQuery = useQuery({
    queryKey: ["execution-test-steps", selectedTestCaseId],
    queryFn: () => api.testSteps.list({ test_case_id: selectedTestCaseId }),
    enabled: Boolean(selectedTestCaseId)
  });

  const selectedSteps = useMemo(
    () => ((stepsQuery.data || []) as TestStep[]).slice().sort((left, right) => left.step_order - right.step_order),
    [stepsQuery.data]
  );

  const currentExecutionStatus = selectedExecution?.status || "queued";
  const isExecutionStarted = currentExecutionStatus === "running";
  const isExecutionLocked = currentExecutionStatus === "completed" || currentExecutionStatus === "failed";

  const resultByCaseId = useMemo(() => {
    const map: Record<string, ExecutionResult> = {};
    executionResults.forEach((result) => {
      map[result.test_case_id] = result;
    });
    return map;
  }, [executionResults]);

  const parseStepStatuses = (result?: ExecutionResult) => {
    if (!result?.logs) {
      return {} as Record<string, StepStatus>;
    }

    try {
      const payload = JSON.parse(result.logs) as { stepStatuses?: Record<string, StepStatus> };
      return payload.stepStatuses || {};
    } catch {
      return {};
    }
  };

  const stepStatuses = useMemo(
    () => parseStepStatuses(resultByCaseId[selectedTestCaseId]),
    [resultByCaseId, selectedTestCaseId]
  );

  const caseDerivedStatus = (testCase: TestCase) => {
    const result = resultByCaseId[testCase.id];
    return result?.status || "queued";
  };

  const suiteMetrics = useMemo(() => {
    return executionSuites.map((suite) => {
      const suiteCases = casesBySuiteId[suite.id] || [];
      const completed = suiteCases.filter((testCase) => ["passed", "failed"].includes(caseDerivedStatus(testCase))).length;
      const failed = suiteCases.some((testCase) => caseDerivedStatus(testCase) === "failed");
      const blocked = suiteCases.some((testCase) => caseDerivedStatus(testCase) === "blocked");
      const percent = suiteCases.length ? Math.round((completed / suiteCases.length) * 100) : 0;

      return {
        suiteId: suite.id,
        count: suiteCases.length,
        percent,
        status: failed ? "failed" : blocked ? "running" : percent === 100 ? "completed" : "queued"
      };
    });
  }, [casesBySuiteId, executionSuites, resultByCaseId]);

  const executionProgress = useMemo(() => {
    const totalCases = executionCaseOrder.length;
    const completedCases = executionCaseOrder.filter((testCase) => ["passed", "failed"].includes(caseDerivedStatus(testCase))).length;
    const failedCases = executionCaseOrder.filter((testCase) => caseDerivedStatus(testCase) === "failed").length;
    const percent = totalCases ? Math.round((completedCases / totalCases) * 100) : 0;

    return {
      totalCases,
      completedCases,
      failedCases,
      percent,
      derivedStatus: failedCases ? "failed" : percent === 100 ? "completed" : completedCases ? "running" : "queued"
    };
  }, [executionCaseOrder, resultByCaseId]);

  const refreshExecutionScope = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["executions"] }),
      queryClient.invalidateQueries({ queryKey: ["executions", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["execution-results", selectedExecutionId] })
    ]);
  };

  const handleCreateExecution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      const response = await createExecution.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId || undefined,
        suite_ids: selectedSuiteIds,
        name: executionName || undefined,
        created_by: session!.user.id
      });

      setExecutionName("");
      setSelectedExecutionId(response.id);
      setExpandedSuiteIds([]);
      setSelectedTestCaseId("");
      setMessage("Execution created.");
      await refreshExecutionScope();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create execution");
    }
  };

  const handleRecordStep = async (stepId: string, status: "passed" | "failed") => {
    const scopedAppTypeId = selectedExecution?.app_type_id;

    if (!selectedExecution || !selectedTestCaseId || !scopedAppTypeId) {
      return;
    }

    const updatedStepStatuses = {
      ...stepStatuses,
      [stepId]: status
    };

    const currentSteps = selectedSteps.map((step) => step.id);
    const allResolved = currentSteps.every((id) => updatedStepStatuses[id]);
    const aggregateStatus: ExecutionResult["status"] =
      Object.values(updatedStepStatuses).includes("failed")
        ? "failed"
        : allResolved
          ? "passed"
          : "blocked";

    const existing = resultByCaseId[selectedTestCaseId];
    const logs = JSON.stringify({ stepStatuses: updatedStepStatuses });

    try {
      if (existing) {
        await updateResult.mutateAsync({
          id: existing.id,
          input: {
            status: aggregateStatus,
            logs,
            error: aggregateStatus === "failed" ? "Step failed during execution" : ""
          }
        });
        queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) =>
          current.map((item) =>
            item.id === existing.id ? { ...item, status: aggregateStatus, logs, error: aggregateStatus === "failed" ? "Step failed during execution" : null } : item
          )
        );
      } else {
        const response = await createResult.mutateAsync({
          execution_id: selectedExecution.id,
          test_case_id: selectedTestCaseId,
          app_type_id: scopedAppTypeId,
          status: aggregateStatus,
          logs,
          error: aggregateStatus === "failed" ? "Step failed during execution" : undefined,
          executed_by: session!.user.id
        });

        queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) => [
          {
            id: response.id,
            execution_id: selectedExecution.id,
            test_case_id: selectedTestCaseId,
            app_type_id: scopedAppTypeId,
            status: aggregateStatus,
            duration_ms: null,
            error: aggregateStatus === "failed" ? "Step failed during execution" : null,
            logs,
            executed_by: session!.user.id
          },
          ...current
        ]);
      }

      setMessage(`Step marked ${status}.`);

      const currentIndex = selectedSteps.findIndex((step) => step.id === stepId);
      const nextStep = selectedSteps[currentIndex + 1];

      if (nextStep) {
        return;
      }

      if (allResolved) {
        const currentCaseIndex = executionCaseOrder.findIndex((testCase) => testCase.id === selectedTestCaseId);
        const nextCase = executionCaseOrder[currentCaseIndex + 1];

        if (nextCase) {
          const nextSuite = executionSuites.find((suite) => suite.id === nextCase.suite_id);
          if (nextSuite && !expandedSuiteIds.includes(nextSuite.id)) {
            setExpandedSuiteIds((current) => [...current, nextSuite.id]);
          }
          setSelectedTestCaseId(nextCase.id);
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to record step result");
    }
  };

  const canCreateExecution = Boolean(projectId && appTypeId && selectedSuiteIds.length);

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Executions"
        title="Run suites as a guided execution workspace"
        description="Pick the project scope, start an execution, expand the suite tree, and move through test cases step by step with live status propagation."
      />

      {message ? <p className="inline-message">{message}</p> : null}

      <Panel title="Create execution" subtitle="Choose the exact app type and suite scope before opening a run.">
        <form className="form-grid" onSubmit={(event) => void handleCreateExecution(event)}>
          <div className="record-grid">
            <FormField label="Project">
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="App Type">
              <select
                disabled={!projectId}
                value={appTypeId}
                onChange={(event) => {
                  setAppTypeId(event.target.value);
                  setSelectedSuiteIds([]);
                }}
              >
                {appTypes.map((appType) => (
                  <option key={appType.id} value={appType.id}>{appType.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Execution name">
              <input value={executionName} onChange={(event) => setExecutionName(event.target.value)} placeholder="Regression cycle 12" />
            </FormField>
          </div>

          <div className="suite-selector-grid">
            {scopeSuites.map((suite) => (
              <button
                key={suite.id}
                className={selectedSuiteIds.includes(suite.id) ? "record-card is-active" : "record-card"}
                onClick={() => {
                  setSelectedSuiteIds((current) =>
                    current.includes(suite.id) ? current.filter((id) => id !== suite.id) : [...current, suite.id]
                  );
                }}
                type="button"
              >
                <div className="record-card-body">
                  <strong>{suite.name}</strong>
                  <span>{suite.parent_id ? "Nested suite" : "Root suite"}</span>
                </div>
              </button>
            ))}
          </div>
          {!scopeSuites.length && appTypeId ? <div className="empty-state compact">No suites available for this app type.</div> : null}

          <button className="primary-button" disabled={!canCreateExecution} type="submit">Create execution</button>
        </form>
      </Panel>

      <div className="design-layout">
        <Panel title="Execution list" subtitle="Pick an execution to inspect tree progress and run steps.">
          <div className="record-list">
            {executions.map((execution) => (
              <button
                key={execution.id}
                className={selectedExecution?.id === execution.id ? "record-card is-active" : "record-card"}
                onClick={() => setSelectedExecutionId(execution.id)}
                type="button"
              >
                <div className="record-card-body">
                  <strong>{execution.name || "Unnamed execution"}</strong>
                  <span>{projects.find((project) => project.id === execution.project_id)?.name || execution.project_id}</span>
                </div>
                <StatusBadge value={execution.status} />
              </button>
            ))}
          </div>
          {!executions.length ? <div className="empty-state compact">No executions created yet.</div> : null}
        </Panel>

        <Panel title="Suite tree" subtitle={selectedExecution ? "Expand suites to lazy load test cases." : "Select an execution to see its scope."}>
          {selectedExecution ? (
            <div className="suite-tree">
              <div className="metric-strip">
                <div className="mini-card">
                  <strong>{executionProgress.percent}%</strong>
                  <span>Execution progress</span>
                </div>
                <div className="mini-card">
                  <strong>{executionProgress.completedCases}/{executionProgress.totalCases}</strong>
                  <span>Completed cases</span>
                </div>
                <div className="mini-card">
                  <strong>{executionProgress.failedCases}</strong>
                  <span>Failed cases</span>
                </div>
              </div>

              {!executionSuites.length ? <div className="empty-state compact">No suites selected for this execution.</div> : null}

              {executionSuites.map((suite) => {
                const suiteCases = casesBySuiteId[suite.id] || [];
                const suiteMetric = suiteMetrics.find((item) => item.suiteId === suite.id);
                const isExpanded = expandedSuiteIds.includes(suite.id);

                return (
                  <div className="tree-suite" key={suite.id}>
                    <button
                      className={selectedExecution?.suite_ids.includes(suite.id) ? "record-card is-active" : "record-card"}
                      onClick={() => {
                        setExpandedSuiteIds((current) =>
                          current.includes(suite.id) ? current.filter((id) => id !== suite.id) : [...current, suite.id]
                        );
                      }}
                      type="button"
                    >
                      <div className="record-card-body">
                        <strong>{suite.name}</strong>
                        <span>{suiteMetric?.count || 0} cases · {suiteMetric?.percent || 0}% complete</span>
                      </div>
                      <StatusBadge value={suiteMetric?.status || "queued"} />
                    </button>

                    {isExpanded ? (
                      <div className="tree-children">
                        {!suiteCases.length ? <div className="empty-state compact">No test cases in this suite.</div> : null}
                        {suiteCases.map((testCase) => (
                          <button
                            key={testCase.id}
                            className={selectedTestCaseId === testCase.id ? "record-card is-active" : "record-card"}
                            onClick={() => setSelectedTestCaseId(testCase.id)}
                            type="button"
                          >
                            <div className="record-card-body">
                              <strong>{testCase.title}</strong>
                              <span>{testCase.description || "No description"}</span>
                            </div>
                            <StatusBadge value={caseDerivedStatus(testCase)} />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state compact">No execution selected.</div>
          )}
        </Panel>

        <Panel title="Step execution" subtitle={selectedTestCaseId ? "Run the current test case step by step." : "Select a test case from the tree."}>
          {selectedExecution ? (
            <div className="detail-stack">
              <div className="detail-summary">
                <strong>{selectedExecution.name || "Unnamed execution"}</strong>
                <span>{appTypes.find((appType) => appType.id === selectedExecution.app_type_id)?.name || "No app type"}</span>
                <span>Derived status: {executionProgress.derivedStatus}</span>
              </div>

              <div className="action-row">
                <button
                  className="ghost-button"
                  disabled={currentExecutionStatus !== "queued"}
                  onClick={() => void startExecution.mutateAsync(selectedExecution.id).then(refreshExecutionScope).catch((error: Error) => setMessage(error.message))}
                  type="button"
                >
                  Start execution
                </button>
                <button
                  className="ghost-button"
                  disabled={currentExecutionStatus !== "running"}
                  onClick={() => void completeExecution.mutateAsync({ id: selectedExecution.id, status: executionProgress.failedCases ? "failed" : "completed" }).then(refreshExecutionScope).catch((error: Error) => setMessage(error.message))}
                  type="button"
                >
                  Complete execution
                </button>
              </div>

              {!selectedExecution.suite_ids.length ? <div className="empty-state compact">No suites selected for this execution.</div> : null}
              {selectedExecution.suite_ids.length && !selectedTestCaseId ? <div className="empty-state compact">No test case selected.</div> : null}
              {selectedTestCaseId && !selectedSteps.length ? <div className="empty-state compact">No steps available for this test case.</div> : null}

              <div className="step-list">
                {selectedSteps.map((step) => {
                  const status = stepStatuses[step.id];
                  return (
                    <article className={status ? `step-card is-expanded step-status-${status}` : "step-card is-expanded"} key={step.id}>
                      <div className="step-card-top">
                        <div>
                          <strong>Step {step.step_order}</strong>
                          <span>{step.action || "No action text"}</span>
                        </div>
                        <StatusBadge value={status || "queued"} />
                      </div>
                      <span>{step.expected_result || "No expected result"}</span>
                      <div className="action-row">
                        <button
                          className="primary-button"
                          disabled={!isExecutionStarted || isExecutionLocked}
                          onClick={() => void handleRecordStep(step.id, "passed")}
                          type="button"
                        >
                          Pass
                        </button>
                        <button
                          className="ghost-button danger"
                          disabled={!isExecutionStarted || isExecutionLocked}
                          onClick={() => void handleRecordStep(step.id, "failed")}
                          type="button"
                        >
                          Fail
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              {!isExecutionStarted && !isExecutionLocked ? <div className="empty-state compact">Start the execution to enable step actions.</div> : null}
              {isExecutionLocked ? <div className="empty-state compact">This execution is locked because it has been completed.</div> : null}
            </div>
          ) : (
            <div className="empty-state compact">Select an execution to begin.</div>
          )}
        </Panel>
      </div>
    </div>
  );
}
