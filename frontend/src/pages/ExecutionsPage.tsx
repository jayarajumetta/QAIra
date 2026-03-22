import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ProgressMeter } from "../components/ProgressMeter";
import { StatusBadge } from "../components/StatusBadge";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { api } from "../lib/api";
import type { AppType, Execution, ExecutionResult, Project, TestCase, TestStep, TestSuite } from "../types";

type StepStatus = "passed" | "failed" | "blocked";
type ExecutionSuiteNode = {
  id: string;
  name: string;
  app_type_id: string | null;
  parent_id: string | null;
  isHistorical?: boolean;
};

export function ExecutionsPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
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
  const allExecutionResultsQuery = useQuery({
    queryKey: ["execution-results"],
    queryFn: () => api.executionResults.list()
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
  const allExecutionResults = allExecutionResultsQuery.data || [];

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

  useEffect(() => {
    const requestedExecutionId = searchParams.get("execution");

    if (requestedExecutionId && executions.some((execution) => execution.id === requestedExecutionId)) {
      setSelectedExecutionId(requestedExecutionId);
    }
  }, [executions, searchParams]);

  const executionAppTypeId = selectedExecution?.app_type_id || "";
  const executionSuitesQuery = useQuery({
    queryKey: ["execution-tree-suites", executionAppTypeId],
    queryFn: () => api.testSuites.list({ app_type_id: executionAppTypeId }),
    enabled: Boolean(executionAppTypeId)
  });

  const executionSuites = useMemo<ExecutionSuiteNode[]>(() => {
    const allSuites = executionSuitesQuery.data || [];
    const liveById = new Map(allSuites.map((suite) => [suite.id, suite]));

    return (selectedExecution?.suite_ids || []).map((suiteId) => {
      const liveSuite = liveById.get(suiteId);

      if (liveSuite) {
        return liveSuite;
      }

      const snapshot = selectedExecution?.suite_snapshots?.find((item) => item.id === suiteId);
      return {
        id: suiteId,
        name: snapshot?.name || "Deleted Suite",
        app_type_id: selectedExecution?.app_type_id || null,
        parent_id: null,
        isHistorical: true
      };
    });
  }, [executionSuitesQuery.data, selectedExecution?.app_type_id, selectedExecution?.suite_ids, selectedExecution?.suite_snapshots]);

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

  const historicalCasesBySuiteId = useMemo(() => {
    const map: Record<string, TestCase[]> = {};

    executionResults.forEach((result) => {
      const suiteId = result.suite_id || "historical-unsorted";
      map[suiteId] = map[suiteId] || [];

      if (!map[suiteId].some((item) => item.id === result.test_case_id)) {
        map[suiteId].push({
          id: result.test_case_id,
          suite_id: suiteId,
          suite_ids: suiteId === "historical-unsorted" ? [] : [suiteId],
          title: result.test_case_title || "Deleted Test Case",
          description: "Historical execution result",
          priority: null,
          status: null,
          requirement_id: null,
          requirement_ids: []
        });
      }
    });

    return map;
  }, [executionResults]);

  const displayCasesBySuiteId = useMemo(() => {
    const map: Record<string, TestCase[]> = {};

    executionSuites.forEach((suite) => {
      map[suite.id] = casesBySuiteId[suite.id]?.length ? casesBySuiteId[suite.id] : (historicalCasesBySuiteId[suite.id] || []);
    });

    return map;
  }, [casesBySuiteId, executionSuites, historicalCasesBySuiteId]);

  const executionCaseOrder = useMemo(() => {
    const ordered: TestCase[] = [];
    executionSuites.forEach((suite) => {
      (displayCasesBySuiteId[suite.id] || []).forEach((testCase) => ordered.push(testCase));
    });
    return ordered;
  }, [displayCasesBySuiteId, executionSuites]);

  useEffect(() => {
    if (selectedTestCaseId && executionCaseOrder.some((testCase) => testCase.id === selectedTestCaseId)) {
      return;
    }

    const firstAvailable = executionSuites
      .map((suite) => displayCasesBySuiteId[suite.id]?.[0])
      .find(Boolean);

    setSelectedTestCaseId(firstAvailable?.id || "");
  }, [displayCasesBySuiteId, executionCaseOrder, executionSuites, selectedTestCaseId]);

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
      const scopedCases = displayCasesBySuiteId[suite.id] || [];
      const completed = scopedCases.filter((testCase) => ["passed", "failed"].includes(caseDerivedStatus(testCase))).length;
      const failed = scopedCases.some((testCase) => caseDerivedStatus(testCase) === "failed");
      const blocked = scopedCases.some((testCase) => caseDerivedStatus(testCase) === "blocked");
      const percent = scopedCases.length ? Math.round((completed / scopedCases.length) * 100) : 0;

      return {
        suiteId: suite.id,
        count: scopedCases.length,
        percent,
        status: failed ? "failed" : blocked ? "running" : percent === 100 ? "completed" : "queued"
      };
    });
  }, [displayCasesBySuiteId, executionSuites, resultByCaseId]);

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

  const executionSummaryById = useMemo(() => {
    const summary: Record<string, { passed: number; total: number; percent: number }> = {};

    allExecutionResults.forEach((result) => {
      summary[result.execution_id] = summary[result.execution_id] || { passed: 0, total: 0, percent: 0 };
      summary[result.execution_id].total += 1;
      if (result.status === "passed") {
        summary[result.execution_id].passed += 1;
      }
    });

    Object.values(summary).forEach((item) => {
      item.percent = item.total ? Math.round((item.passed / item.total) * 100) : 0;
    });

    return summary;
  }, [allExecutionResults]);

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
        const nextSuite = executionSuites.find((suite) => (nextCase.suite_ids || []).includes(suite.id) || nextCase.suite_id === suite.id);
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
        title="Test Executions"
        description="Scope a run by project, app type, and suites, then execute step by step with live progress and pass-rate visibility."
        actions={<button className="primary-button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} type="button">+ Create Execution</button>}
      />

      {message ? <p className="inline-message">{message}</p> : null}

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={(value) => {
          setAppTypeId(value);
          setSelectedSuiteIds([]);
        }}
        onProjectChange={setProjectId}
        projectId={projectId}
        projects={projects}
      />

      <Panel title="Create execution" subtitle="Choose the exact app type and suite scope before opening a run.">
        <form className="form-grid" onSubmit={(event) => void handleCreateExecution(event)}>
          <div className="record-grid">
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
          {executionsQuery.isLoading ? (
            <div className="record-list">
              <div className="skeleton-block" />
              <div className="skeleton-block" />
              <div className="skeleton-block" />
            </div>
          ) : null}
          <div className="record-list">
            {executions.map((execution) => (
              <button
                key={execution.id}
                className={selectedExecution?.id === execution.id ? "record-card execution-card is-active" : "record-card execution-card"}
                onClick={() => setSelectedExecutionId(execution.id)}
                type="button"
              >
                <div className="record-card-body">
                  <div className="record-card-header">
                    <div className="record-card-icon execution">▶</div>
                    <strong>{execution.name || "Unnamed execution"}</strong>
                    <span className="object-type-badge execution">Execution</span>
                  </div>
                  <div className="record-meta">
                    <div className="record-meta-row">
                      <strong>Project</strong>
                      <span>{projects.find((project) => project.id === execution.project_id)?.name || execution.project_id}</span>
                    </div>
                    <div className="record-meta-row">
                      <strong>Status</strong>
                      <span className="execution-status-indicator" style={{ textTransform: 'capitalize' }}>{execution.status}</span>
                    </div>
                  </div>
                  <ProgressMeter
                    detail={`${executionSummaryById[execution.id]?.passed || 0}/${executionSummaryById[execution.id]?.total || 0} passed`}
                    value={executionSummaryById[execution.id]?.percent || 0}
                  />
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
                  <ProgressMeter detail={`${executionProgress.completedCases}/${executionProgress.totalCases} complete`} label="Execution progress" value={executionProgress.percent} />
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
                const suiteCases = displayCasesBySuiteId[suite.id] || [];
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
                        <ProgressMeter detail={`${suiteMetric?.count || 0} cases`} label="Suite completion" value={suiteMetric?.percent || 0} />
                        {suite.isHistorical ? <span>Historical snapshot</span> : null}
                      </div>
                      <StatusBadge value={suiteMetric?.status || "queued"} />
                    </button>

                    {isExpanded ? (
                      <div className="tree-children">
                        {!suiteCases.length ? <div className="empty-state compact">No test cases in this suite.</div> : null}
                        {suiteCases.map((testCase) => (
                          <button
                            key={testCase.id}
                            className={selectedTestCaseId === testCase.id ? "record-card test-case-card is-active" : "record-card test-case-card"}
                            onClick={() => setSelectedTestCaseId(testCase.id)}
                            type="button"
                          >
                            <div className="record-card-body">
                              <div className="record-card-header">
                                <div className="record-card-icon test-case">📄</div>
                                <strong>{testCase.title}</strong>
                                <span className="object-type-badge test-case">Test Case</span>
                              </div>
                              <div className="record-meta">
                                <div className="record-meta-row">
                                  <strong>Suite</strong>
                                  <span>{suite.name}</span>
                                </div>
                                <div className="record-meta-row">
                                  <strong>Description</strong>
                                  <span>{testCase.description || "No description"}</span>
                                </div>
                                {!casesBySuiteId[suite.id]?.some((item) => item.id === testCase.id) ? (
                                  <div className="record-meta-row">
                                    <strong>Info</strong>
                                    <span className="object-context">Deleted reference</span>
                                  </div>
                                ) : null}
                              </div>
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
              {selectedTestCaseId && !selectedSteps.length ? <div className="empty-state compact">No live steps available. Historical results are still preserved for this test case.</div> : null}

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
