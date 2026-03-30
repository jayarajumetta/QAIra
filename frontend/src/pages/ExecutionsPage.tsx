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
  const [isSuitePickerOpen, setIsSuitePickerOpen] = useState(false);
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const [expandedSuiteIds, setExpandedSuiteIds] = useState<string[]>([]);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
  const [executionName, setExecutionName] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");

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
  const selectedScopeSuites = useMemo(
    () => scopeSuites.filter((suite) => selectedSuiteIds.includes(suite.id)),
    [scopeSuites, selectedSuiteIds]
  );

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

  useEffect(() => {
    setExpandedStepIds([]);
  }, [selectedTestCaseId]);

  useEffect(() => {
    setExpandedStepIds((current) => current.filter((id) => selectedSteps.some((step) => step.id === id)));
  }, [selectedSteps]);

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
      const scopedCases = displayCasesBySuiteId[suite.id] || [];
      const passedCount = scopedCases.filter((testCase) => caseDerivedStatus(testCase) === "passed").length;
      const failedCount = scopedCases.filter((testCase) => caseDerivedStatus(testCase) === "failed").length;
      const blockedCount = scopedCases.filter((testCase) => caseDerivedStatus(testCase) === "blocked").length;
      const completed = passedCount + failedCount;
      const failed = failedCount > 0;
      const blocked = blockedCount > 0;
      const percent = scopedCases.length ? Math.round((completed / scopedCases.length) * 100) : 0;
      const pendingCount = Math.max(scopedCases.length - passedCount - failedCount, 0);

      return {
        suiteId: suite.id,
        count: scopedCases.length,
        passedCount,
        failedCount,
        pendingCount,
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

  const executionStatusCounts = useMemo(() => {
    return executionCaseOrder.reduce(
      (summary, testCase) => {
        const status = caseDerivedStatus(testCase);
        summary[status] = (summary[status] || 0) + 1;
        return summary;
      },
      { queued: 0, passed: 0, failed: 0, blocked: 0 } as Record<string, number>
    );
  }, [executionCaseOrder, resultByCaseId]);

  const blockingCases = useMemo(() => {
    return executionCaseOrder.filter((testCase) => ["failed", "blocked"].includes(caseDerivedStatus(testCase))).slice(0, 6);
  }, [executionCaseOrder, resultByCaseId]);

  const historicalReferenceCount = useMemo(() => {
    return executionSuites.reduce((count, suite) => {
      const liveIds = new Set((casesBySuiteId[suite.id] || []).map((item) => item.id));
      return count + (displayCasesBySuiteId[suite.id] || []).filter((item) => !liveIds.has(item.id)).length;
    }, 0);
  }, [casesBySuiteId, displayCasesBySuiteId, executionSuites]);

  const executionSummaryById = useMemo(() => {
    const summary: Record<string, { passed: number; failed: number; blocked: number; total: number; passRate: number }> = {};

    allExecutionResults.forEach((result) => {
      summary[result.execution_id] = summary[result.execution_id] || { passed: 0, failed: 0, blocked: 0, total: 0, passRate: 0 };
      summary[result.execution_id].total += 1;
      if (result.status === "passed") {
        summary[result.execution_id].passed += 1;
      } else if (result.status === "failed") {
        summary[result.execution_id].failed += 1;
      } else if (result.status === "blocked") {
        summary[result.execution_id].blocked += 1;
      }
    });

    Object.values(summary).forEach((item) => {
      item.passRate = item.total ? Math.round((item.passed / item.total) * 100) : 0;
    });

    return summary;
  }, [allExecutionResults]);

  const buildProgressSegments = (passedCount: number, failedCount: number, pendingCount: number, totalCount: number) => {
    if (!totalCount) {
      return [{ value: 100, tone: "neutral" as const }];
    }

    const segments = [
      { value: (passedCount / totalCount) * 100, tone: "success" as const },
      { value: (failedCount / totalCount) * 100, tone: "danger" as const },
      { value: (pendingCount / totalCount) * 100, tone: "neutral" as const }
    ];

    return segments.filter((segment) => segment.value > 0);
  };

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
      setIsSuitePickerOpen(false);
      showSuccess("Execution created.");
      await refreshExecutionScope();
    } catch (error) {
      showError(error, "Unable to create execution");
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

      showSuccess(`Step marked ${status}.`);

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
      showError(error, "Unable to record step result");
    }
  };

  const canCreateExecution = Boolean(projectId && appTypeId && selectedSuiteIds.length);
  const selectedExecutionCase = executionCaseOrder.find((testCase) => testCase.id === selectedTestCaseId) || null;
  const selectedExecutionSuite = executionSuites.find(
    (suite) => selectedExecutionCase && ((selectedExecutionCase.suite_ids || []).includes(suite.id) || selectedExecutionCase.suite_id === suite.id)
  ) || null;
  const selectedStepProgress = useMemo(() => {
    const passedCount = selectedSteps.filter((step) => stepStatuses[step.id] === "passed").length;
    const failedCount = selectedSteps.filter((step) => stepStatuses[step.id] === "failed").length;
    const pendingCount = Math.max(selectedSteps.length - passedCount - failedCount, 0);
    const completedCount = passedCount + failedCount;
    const percent = selectedSteps.length ? Math.round((completedCount / selectedSteps.length) * 100) : 0;

    return {
      passedCount,
      failedCount,
      pendingCount,
      percent
    };
  }, [selectedSteps, stepStatuses]);

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Executions"
        title="Test Executions"
        description="Scope a run by project, app type, and suites, then execute step by step with live progress and pass-rate visibility."
        actions={<button className="primary-button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} type="button">+ Create Execution</button>}
      />

      {message ? <p className={messageTone === "error" ? "inline-message error-message" : "inline-message success-message"}>{message}</p> : null}

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={(value) => {
          setAppTypeId(value);
          setSelectedSuiteIds([]);
          setIsSuitePickerOpen(false);
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

          <FormField label="Suite scope">
            <div className="selection-summary-card">
              <div className="selection-summary-header">
                <div>
                  <strong>{selectedScopeSuites.length ? `${selectedScopeSuites.length} suites selected` : "No suites selected yet"}</strong>
                  <span>Pick one or more suites for this execution. The picker opens in a focused modal and collapses back into this summary.</span>
                </div>
                <button className="ghost-button" disabled={!scopeSuites.length} onClick={() => setIsSuitePickerOpen(true)} type="button">
                  Select suites
                </button>
              </div>

              {selectedScopeSuites.length ? (
                <div className="selection-chip-row">
                  {selectedScopeSuites.map((suite) => (
                    <button
                      key={suite.id}
                      className="selection-chip"
                      onClick={() => setSelectedSuiteIds((current) => current.filter((id) => id !== suite.id))}
                      type="button"
                    >
                      {suite.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </FormField>

          {!scopeSuites.length && appTypeId ? <div className="empty-state compact">No suites available for this app type.</div> : null}

          <button className="primary-button" disabled={!canCreateExecution} type="submit">Create execution</button>
        </form>
      </Panel>

      {selectedExecution ? (
        <Panel title="Execution dashboard" subtitle="A high-signal view of run progress, blockers, suite readiness, and preserved historical references.">
          <div className="detail-stack">
            <div className="metric-strip">
              <div className="mini-card">
                <strong>{executionProgress.percent}%</strong>
                <span>{executionProgress.completedCases}/{executionProgress.totalCases} cases complete</span>
              </div>
              <div className="mini-card">
                <strong>{executionStatusCounts.passed}</strong>
                <span>Passed cases</span>
              </div>
              <div className="mini-card">
                <strong>{executionStatusCounts.failed}</strong>
                <span>Failed cases</span>
              </div>
              <div className="mini-card">
                <strong>{historicalReferenceCount}</strong>
                <span>Historical case references preserved</span>
              </div>
            </div>

            <div className="two-column-grid">
              <div className="stack-list">
                {blockingCases.map((testCase) => (
                  <button
                    className="stack-item stack-item-button"
                    key={testCase.id}
                    onClick={() => setSelectedTestCaseId(testCase.id)}
                    type="button"
                  >
                    <div>
                      <strong>{testCase.title}</strong>
                      <span>{testCase.description || "No description"}</span>
                    </div>
                    <StatusBadge value={caseDerivedStatus(testCase)} />
                  </button>
                ))}
                {!blockingCases.length ? <div className="empty-state compact">No active blockers. This run is clean so far.</div> : null}
              </div>

              <div className="stack-list">
                {suiteMetrics.map((suiteMetric) => {
                  const suite = executionSuites.find((item) => item.id === suiteMetric.suiteId);
                  return (
                    <div className="stack-item" key={suiteMetric.suiteId}>
                      <div>
                        <strong>{suite?.name || "Suite"}</strong>
                        <ProgressMeter
                          detail={`${suiteMetric.passedCount} passed · ${suiteMetric.failedCount} failed · ${suiteMetric.pendingCount} pending`}
                          label="Suite completion"
                          segments={buildProgressSegments(suiteMetric.passedCount, suiteMetric.failedCount, suiteMetric.pendingCount, suiteMetric.count)}
                          value={suiteMetric.percent}
                        />
                      </div>
                      <StatusBadge value={suiteMetric.status} />
                    </div>
                  );
                })}
                {!suiteMetrics.length ? <div className="empty-state compact">Select or create an execution to see suite readiness.</div> : null}
              </div>
            </div>
          </div>
        </Panel>
      ) : null}

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
                className={selectedExecution?.id === execution.id ? "record-card tile-card execution-card is-active" : "record-card tile-card execution-card"}
                onClick={() => setSelectedExecutionId(execution.id)}
                type="button"
              >
                <div className="tile-card-main">
                  <div className="tile-card-header">
                    <div className="record-card-icon execution">EX</div>
                    <div className="tile-card-title-group">
                      <strong>{execution.name || "Unnamed execution"}</strong>
                      <span className="tile-card-kicker">{projects.find((project) => project.id === execution.project_id)?.name || execution.project_id}</span>
                    </div>
                  </div>
                  <p className="tile-card-description">
                    {appTypes.find((appType) => appType.id === execution.app_type_id)?.name || "No app type scoped"} · {(execution.trigger || "manual").toUpperCase()} run
                  </p>
                  <div className="tile-card-metrics">
                    <span className="tile-metric">{execution.suite_ids.length} suites</span>
                    <span className="tile-metric">{executionSummaryById[execution.id]?.total || 0} results logged</span>
                    <span className="tile-metric">{executionSummaryById[execution.id]?.failed || 0} failed</span>
                  </div>
                  <ProgressMeter
                    detail={`${executionSummaryById[execution.id]?.passed || 0} passed · ${executionSummaryById[execution.id]?.failed || 0} failed · ${executionSummaryById[execution.id]?.blocked || 0} blocked`}
                    segments={buildProgressSegments(
                      executionSummaryById[execution.id]?.passed || 0,
                      executionSummaryById[execution.id]?.failed || 0,
                      executionSummaryById[execution.id]?.blocked || 0,
                      executionSummaryById[execution.id]?.total || 0
                    )}
                    value={executionSummaryById[execution.id]?.passRate || 0}
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
                  <ProgressMeter
                    detail={`${executionStatusCounts.passed} passed · ${executionStatusCounts.failed} failed · ${Math.max(executionProgress.totalCases - executionStatusCounts.passed - executionStatusCounts.failed, 0)} pending`}
                    label="Execution progress"
                    segments={buildProgressSegments(
                      executionStatusCounts.passed,
                      executionStatusCounts.failed,
                      Math.max(executionProgress.totalCases - executionStatusCounts.passed - executionStatusCounts.failed, 0),
                      executionProgress.totalCases
                    )}
                    value={executionProgress.percent}
                  />
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
                      className={isExpanded ? "record-card tile-card is-active" : "record-card tile-card"}
                      onClick={() => {
                        setExpandedSuiteIds((current) =>
                          current.includes(suite.id) ? current.filter((id) => id !== suite.id) : [...current, suite.id]
                        );
                      }}
                      type="button"
                    >
                      <div className="tile-card-main">
                        <div className="tile-card-header">
                          <div className="record-card-icon test-suite">SU</div>
                          <div className="tile-card-title-group">
                            <strong>{suite.name}</strong>
                            <span className="tile-card-kicker">{suite.isHistorical ? "Historical suite snapshot" : "Live suite scope"}</span>
                          </div>
                        </div>
                        <p className="tile-card-description">
                          {suite.isHistorical ? "Historical execution evidence retained even if the suite changed later." : "Expand to inspect the cases currently carried by this suite."}
                        </p>
                        <div className="tile-card-metrics">
                          <span className="tile-metric">{suiteMetric?.count || 0} cases</span>
                          <span className="tile-metric">{suiteMetric?.failedCount || 0} failed</span>
                        </div>
                        <ProgressMeter
                          detail={`${suiteMetric?.passedCount || 0} passed · ${suiteMetric?.failedCount || 0} failed · ${suiteMetric?.pendingCount || 0} pending`}
                          label="Suite completion"
                          segments={buildProgressSegments(
                            suiteMetric?.passedCount || 0,
                            suiteMetric?.failedCount || 0,
                            suiteMetric?.pendingCount || 0,
                            suiteMetric?.count || 0
                          )}
                          value={suiteMetric?.percent || 0}
                        />
                      </div>
                      <StatusBadge value={suiteMetric?.status || "queued"} />
                    </button>

                    {isExpanded ? (
                      <div className="tree-children">
                        {!suiteCases.length ? <div className="empty-state compact">No test cases in this suite.</div> : null}
                        {suiteCases.map((testCase) => (
                          <button
                            key={testCase.id}
                            className={selectedTestCaseId === testCase.id ? "record-card tile-card test-case-card is-active" : "record-card tile-card test-case-card"}
                            onClick={() => setSelectedTestCaseId(testCase.id)}
                            type="button"
                          >
                            <div className="tile-card-main">
                              <div className="tile-card-header">
                                <div className="record-card-icon test-case">TC</div>
                                <div className="tile-card-title-group">
                                  <strong>{testCase.title}</strong>
                                  <span className="tile-card-kicker">{suite.name}</span>
                                </div>
                              </div>
                              <p className="tile-card-description">{testCase.description || "No description recorded for this test case."}</p>
                              <div className="tile-card-metrics">
                                <span className="tile-metric">Priority P{testCase.priority || 3}</span>
                                {!casesBySuiteId[suite.id]?.some((item) => item.id === testCase.id) ? (
                                  <span className="tile-metric">Historical reference</span>
                                ) : (
                                  <span className="tile-metric">Live definition</span>
                                )}
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
                <strong>{selectedExecutionCase?.title || selectedExecution.name || "Unnamed execution"}</strong>
                <span>{selectedExecutionSuite?.name || appTypes.find((appType) => appType.id === selectedExecution.app_type_id)?.name || "No suite selected"}</span>
                <span>Case status: {selectedExecutionCase ? caseDerivedStatus(selectedExecutionCase) : executionProgress.derivedStatus}</span>
                {selectedExecutionCase ? (
                  <ProgressMeter
                    detail={`${selectedStepProgress.passedCount} passed · ${selectedStepProgress.failedCount} failed · ${selectedStepProgress.pendingCount} pending`}
                    label="Step progress"
                    segments={buildProgressSegments(
                      selectedStepProgress.passedCount,
                      selectedStepProgress.failedCount,
                      selectedStepProgress.pendingCount,
                      selectedSteps.length
                    )}
                    value={selectedStepProgress.percent}
                  />
                ) : null}
              </div>

              <div className="action-row">
                <button
                  className="ghost-button"
                  disabled={currentExecutionStatus !== "queued"}
                  onClick={() => void startExecution.mutateAsync(selectedExecution.id).then(refreshExecutionScope).catch((error: Error) => showError(error, "Unable to start execution"))}
                  type="button"
                >
                  Start execution
                </button>
                <button
                  className="ghost-button"
                  disabled={currentExecutionStatus !== "running"}
                  onClick={() => void completeExecution.mutateAsync({ id: selectedExecution.id, status: executionProgress.failedCases ? "failed" : "completed" }).then(refreshExecutionScope).catch((error: Error) => showError(error, "Unable to complete execution"))}
                  type="button"
                >
                  Complete execution
                </button>
              </div>

              {!selectedExecution.suite_ids.length ? <div className="empty-state compact">No suites selected for this execution.</div> : null}
              {selectedExecution.suite_ids.length && !selectedTestCaseId ? <div className="empty-state compact">No test case selected.</div> : null}
              {selectedTestCaseId && !selectedSteps.length ? <div className="empty-state compact">No live steps available. Historical results are still preserved for this test case.</div> : null}

              {selectedSteps.length ? (
                <div className="action-row">
                  <button className="ghost-button" onClick={() => setExpandedStepIds(selectedSteps.map((step) => step.id))} type="button">
                    Expand all
                  </button>
                  <button className="ghost-button" onClick={() => setExpandedStepIds([])} type="button">
                    Collapse all
                  </button>
                </div>
              ) : null}

              <div className="step-list">
                {selectedSteps.map((step) => {
                  const status = stepStatuses[step.id];
                  return (
                    <ExecutionStepCard
                      key={step.id}
                      isExpanded={expandedStepIds.includes(step.id)}
                      isLocked={!isExecutionStarted || isExecutionLocked}
                      onFail={() => void handleRecordStep(step.id, "failed")}
                      onPass={() => void handleRecordStep(step.id, "passed")}
                      onToggle={() =>
                        setExpandedStepIds((current) =>
                          current.includes(step.id) ? current.filter((id) => id !== step.id) : [...current, step.id]
                        )
                      }
                      status={status || "queued"}
                      step={step}
                    />
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

      {isSuitePickerOpen ? (
        <ExecutionSuitePickerModal
          selectedSuiteIds={selectedSuiteIds}
          suites={scopeSuites}
          onClose={() => setIsSuitePickerOpen(false)}
          onToggleSuite={(suiteId) =>
            setSelectedSuiteIds((current) =>
              current.includes(suiteId) ? current.filter((id) => id !== suiteId) : [...current, suiteId]
            )
          }
        />
      ) : null}
    </div>
  );
}

function ExecutionStepCard({
  step,
  status,
  isExpanded,
  isLocked,
  onToggle,
  onPass,
  onFail
}: {
  step: TestStep;
  status: ExecutionResult["status"] | "queued";
  isExpanded: boolean;
  isLocked: boolean;
  onToggle: () => void;
  onPass: () => void;
  onFail: () => void;
}) {
  return (
    <article className={status !== "queued" ? `step-card${isExpanded ? " is-expanded" : ""} step-status-${status}` : isExpanded ? "step-card is-expanded" : "step-card"}>
      <button className="step-card-toggle" onClick={onToggle} type="button">
        <div className="step-card-toggle-main">
          <div>
            <strong>Step {step.step_order}</strong>
            <span>{step.action || "No action text"}</span>
          </div>
          <div className="step-card-toggle-meta">
            <StatusBadge value={status} />
            <span>{isExpanded ? "Hide" : "Show"}</span>
          </div>
        </div>
      </button>

      {isExpanded ? (
        <div className="step-card-body">
          <p className="execution-step-expected">{step.expected_result || "No expected result"}</p>
          <div className="action-row">
            <button className="primary-button" disabled={isLocked} onClick={onPass} type="button">
              Pass
            </button>
            <button className="ghost-button danger" disabled={isLocked} onClick={onFail} type="button">
              Fail
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ExecutionSuitePickerModal({
  suites,
  selectedSuiteIds,
  onClose,
  onToggleSuite
}: {
  suites: TestSuite[];
  selectedSuiteIds: string[];
  onClose: () => void;
  onToggleSuite: (suiteId: string) => void;
}) {
  const selectedCount = selectedSuiteIds.length;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card selection-modal-card" aria-label="Select execution suites" aria-modal="true" role="dialog">
        <div className="panel-head">
          <div>
            <h3>Select suite scope</h3>
            <p>Choose the suites to include in this execution. Your selection collapses back into the summary card once you are done.</p>
          </div>
        </div>

        <div className="detail-stack">
          <div className="detail-summary">
            <strong>{selectedCount ? `${selectedCount} suites selected` : "No suites selected"}</strong>
            <span>{selectedCount ? "You can remove any selection here before creating the execution." : "Pick one or more suites to build the execution scope."}</span>
          </div>

          <div className="modal-case-picker selection-picker-grid">
            {suites.map((suite) => (
              <label className="modal-case-option selection-option" key={suite.id}>
                <input
                  checked={selectedSuiteIds.includes(suite.id)}
                  onChange={() => onToggleSuite(suite.id)}
                  type="checkbox"
                />
                <div>
                  <strong>{suite.name}</strong>
                  <span>{suite.parent_id ? "Nested suite" : "Root suite"}</span>
                </div>
              </label>
            ))}
            {!suites.length ? <div className="empty-state compact">No suites available for the current app type.</div> : null}
          </div>

          <div className="action-row">
            <button className="primary-button" onClick={onClose} type="button">Done</button>
            <button className="ghost-button" onClick={onClose} type="button">Collapse picker</button>
          </div>
        </div>
      </div>
    </div>
  );
}
