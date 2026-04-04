import { FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ProgressMeter } from "../components/ProgressMeter";
import { StatusBadge } from "../components/StatusBadge";
import { SubnavTabs } from "../components/SubnavTabs";
import { ToastMessage } from "../components/ToastMessage";
import { VirtualList } from "../components/VirtualList";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { api } from "../lib/api";
import type { Execution, ExecutionCaseSnapshot, ExecutionResult, ExecutionStepSnapshot, TestStep, TestSuite } from "../types";

type StepStatus = "passed" | "failed" | "blocked";
type ExecutionTab = "overview" | "logs" | "failures";

type ExecutionSuiteNode = {
  id: string;
  name: string;
  isHistorical?: boolean;
};

type ExecutionCaseView = {
  id: string;
  title: string;
  description: string | null;
  priority: number | null;
  status: string | null;
  suite_id: string | null;
  suite_ids: string[];
  sort_order: number;
};

function toCaseView(snapshot: ExecutionCaseSnapshot): ExecutionCaseView {
  return {
    id: snapshot.test_case_id,
    title: snapshot.test_case_title,
    description: snapshot.test_case_description,
    priority: snapshot.priority,
    status: snapshot.status,
    suite_id: snapshot.suite_id,
    suite_ids: snapshot.suite_id ? [snapshot.suite_id] : [],
    sort_order: snapshot.sort_order
  };
}

function toStepView(snapshot: ExecutionStepSnapshot): TestStep {
  return {
    id: snapshot.snapshot_step_id,
    test_case_id: snapshot.test_case_id,
    step_order: snapshot.step_order,
    action: snapshot.action,
    expected_result: snapshot.expected_result
  };
}

function buildProgressSegments(
  passedCount: number,
  failedCount: number,
  blockedCount: number,
  totalCount: number
) {
  if (!totalCount) {
    return [{ value: 100, tone: "neutral" as const }];
  }

  const pendingCount = Math.max(totalCount - passedCount - failedCount - blockedCount, 0);
  const segments = [
    { value: (passedCount / totalCount) * 100, tone: "success" as const },
    { value: (failedCount / totalCount) * 100, tone: "danger" as const },
    { value: (blockedCount / totalCount) * 100, tone: "info" as const },
    { value: (pendingCount / totalCount) * 100, tone: "neutral" as const }
  ];

  return segments.filter((segment) => segment.value > 0);
}

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
  const [activeTab, setActiveTab] = useState<ExecutionTab>("overview");
  const [executionSearch, setExecutionSearch] = useState("");
  const deferredExecutionSearch = useDeferredValue(executionSearch);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list
  });
  const executionsQuery = useQuery({
    queryKey: ["executions", projectId],
    queryFn: () => api.executions.list(projectId ? { project_id: projectId } : undefined)
  });
  const selectedExecutionQuery = useQuery({
    queryKey: ["execution", selectedExecutionId],
    queryFn: () => api.executions.get(selectedExecutionId),
    enabled: Boolean(selectedExecutionId)
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

  useEffect(() => {
    const requestedExecutionId = searchParams.get("execution");

    if (requestedExecutionId && executions.some((execution) => execution.id === requestedExecutionId)) {
      setSelectedExecutionId(requestedExecutionId);
      return;
    }

    if (!selectedExecutionId && executions[0]) {
      setSelectedExecutionId(executions[0].id);
      return;
    }

    if (selectedExecutionId && !executions.some((execution) => execution.id === selectedExecutionId)) {
      setSelectedExecutionId(executions[0]?.id || "");
    }
  }, [executions, searchParams, selectedExecutionId]);

  const selectedExecution = selectedExecutionQuery.data || executions.find((execution) => execution.id === selectedExecutionId) || null;
  const selectedExecutionSuiteIds = selectedExecution?.suite_ids || [];
  const selectedExecutionSuites = selectedExecution?.suite_snapshots || [];
  const snapshotCases = useMemo(
    () => ((selectedExecution?.case_snapshots || []).slice().sort((left, right) => left.sort_order - right.sort_order)),
    [selectedExecution?.case_snapshots]
  );
  const snapshotSteps = selectedExecution?.step_snapshots || [];

  const executionSuites = useMemo<ExecutionSuiteNode[]>(
    () => selectedExecutionSuites.map((suite) => ({ id: suite.id, name: suite.name })),
    [selectedExecutionSuites]
  );

  const displayCasesBySuiteId = useMemo(() => {
    return snapshotCases.reduce<Record<string, ExecutionCaseView[]>>((groups, snapshot) => {
      const suiteId = snapshot.suite_id || "unsorted";
      groups[suiteId] = groups[suiteId] || [];
      groups[suiteId].push(toCaseView(snapshot));
      return groups;
    }, {});
  }, [snapshotCases]);

  const executionCaseOrder = useMemo(
    () => snapshotCases.map(toCaseView),
    [snapshotCases]
  );

  const stepsByCaseId = useMemo(() => {
    return snapshotSteps.reduce<Record<string, TestStep[]>>((groups, snapshot) => {
      groups[snapshot.test_case_id] = groups[snapshot.test_case_id] || [];
      groups[snapshot.test_case_id].push(toStepView(snapshot));
      return groups;
    }, {});
  }, [snapshotSteps]);

  const selectedSteps = useMemo(
    () => (stepsByCaseId[selectedTestCaseId] || []).slice().sort((left, right) => left.step_order - right.step_order),
    [selectedTestCaseId, stepsByCaseId]
  );

  useEffect(() => {
    if (selectedTestCaseId && executionCaseOrder.some((testCase) => testCase.id === selectedTestCaseId)) {
      return;
    }

    setSelectedTestCaseId(executionCaseOrder[0]?.id || "");
  }, [executionCaseOrder, selectedTestCaseId]);

  useEffect(() => {
    if (!executionSuites.length) {
      setExpandedSuiteIds([]);
      return;
    }

    setExpandedSuiteIds((current) =>
      current.length ? current.filter((id) => executionSuites.some((suite) => suite.id === id)) : [executionSuites[0].id]
    );
  }, [executionSuites]);

  useEffect(() => {
    setExpandedStepIds([]);
    setActiveTab("overview");
  }, [selectedExecutionId, selectedTestCaseId]);

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

  const caseDerivedStatus = (testCase: ExecutionCaseView) => {
    const result = resultByCaseId[testCase.id];
    return result?.status || "queued";
  };

  const suiteMetrics = useMemo(() => {
    return executionSuites.map((suite) => {
      const scopedCases = displayCasesBySuiteId[suite.id] || [];
      const passedCount = scopedCases.filter((testCase) => caseDerivedStatus(testCase) === "passed").length;
      const failedCount = scopedCases.filter((testCase) => caseDerivedStatus(testCase) === "failed").length;
      const blockedCount = scopedCases.filter((testCase) => caseDerivedStatus(testCase) === "blocked").length;
      const percent = scopedCases.length
        ? Math.round(((passedCount + failedCount + blockedCount) / scopedCases.length) * 100)
        : 0;

      return {
        suiteId: suite.id,
        count: scopedCases.length,
        passedCount,
        failedCount,
        blockedCount,
        percent,
        status: failedCount ? "failed" : blockedCount ? "running" : percent === 100 ? "completed" : "queued"
      };
    });
  }, [displayCasesBySuiteId, executionSuites, resultByCaseId]);

  const executionProgress = useMemo(() => {
    const totalCases = executionCaseOrder.length;
    const passedCount = executionCaseOrder.filter((testCase) => caseDerivedStatus(testCase) === "passed").length;
    const failedCount = executionCaseOrder.filter((testCase) => caseDerivedStatus(testCase) === "failed").length;
    const blockedCount = executionCaseOrder.filter((testCase) => caseDerivedStatus(testCase) === "blocked").length;
    const percent = totalCases ? Math.round(((passedCount + failedCount + blockedCount) / totalCases) * 100) : 0;

    return {
      totalCases,
      passedCount,
      failedCount,
      blockedCount,
      completedCases: passedCount + failedCount + blockedCount,
      percent,
      derivedStatus: failedCount ? "failed" : blockedCount ? "running" : percent === 100 ? "completed" : "queued"
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

  const blockingCases = useMemo(
    () => executionCaseOrder.filter((testCase) => ["failed", "blocked"].includes(caseDerivedStatus(testCase))).slice(0, 8),
    [executionCaseOrder, resultByCaseId]
  );

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

  const refreshExecutionScope = async (executionId = selectedExecutionId) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["executions"] }),
      queryClient.invalidateQueries({ queryKey: ["executions", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["execution-results", executionId] }),
      queryClient.invalidateQueries({ queryKey: ["execution", executionId] }),
      queryClient.invalidateQueries({ queryKey: ["execution-results"] })
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
      setSelectedTestCaseId("");
      setExpandedSuiteIds([]);
      setIsSuitePickerOpen(false);
      showSuccess("Execution created from a snapshot of the selected suites.");
      await refreshExecutionScope(response.id);
    } catch (error) {
      showError(error, "Unable to create execution");
    }
  };

  const handleRecordStep = async (stepId: string, status: "passed" | "failed") => {
    const scopedAppTypeId = selectedExecution?.app_type_id;
    const currentCaseSnapshot = snapshotCases.find((snapshot) => snapshot.test_case_id === selectedTestCaseId);

    if (!selectedExecution || !selectedTestCaseId || !scopedAppTypeId || !currentCaseSnapshot) {
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
            item.id === existing.id
              ? { ...item, status: aggregateStatus, logs, error: aggregateStatus === "failed" ? "Step failed during execution" : null }
              : item
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
            test_case_title: currentCaseSnapshot.test_case_title,
            suite_id: currentCaseSnapshot.suite_id,
            suite_name: currentCaseSnapshot.suite_name,
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

      if (allResolved) {
        const currentCaseIndex = executionCaseOrder.findIndex((testCase) => testCase.id === selectedTestCaseId);
        const nextCase = executionCaseOrder[currentCaseIndex + 1];

        if (nextCase) {
          if (nextCase.suite_id && !expandedSuiteIds.includes(nextCase.suite_id)) {
            setExpandedSuiteIds((current) => [...current, nextCase.suite_id!]);
          }
          setSelectedTestCaseId(nextCase.id);
        }
      }
    } catch (error) {
      showError(error, "Unable to record step result");
    }
  };

  const selectedExecutionCase = executionCaseOrder.find((testCase) => testCase.id === selectedTestCaseId) || null;
  const selectedExecutionResult = selectedExecutionCase ? resultByCaseId[selectedExecutionCase.id] : null;
  const selectedStepProgress = useMemo(() => {
    const passedCount = selectedSteps.filter((step) => stepStatuses[step.id] === "passed").length;
    const failedCount = selectedSteps.filter((step) => stepStatuses[step.id] === "failed").length;
    const pendingCount = Math.max(selectedSteps.length - passedCount - failedCount, 0);
    const percent = selectedSteps.length ? Math.round(((passedCount + failedCount) / selectedSteps.length) * 100) : 0;

    return {
      passedCount,
      failedCount,
      pendingCount,
      percent
    };
  }, [selectedSteps, stepStatuses]);

  const filteredExecutions = useMemo(() => {
    const search = deferredExecutionSearch.trim().toLowerCase();

    if (!search) {
      return executions;
    }

    return executions.filter((execution) => {
      const projectName = projects.find((project) => project.id === execution.project_id)?.name || "";
      return [execution.name || "", projectName].some((value) => value.toLowerCase().includes(search));
    });
  }, [deferredExecutionSearch, executions, projects]);

  const currentExecutionStatus = selectedExecution?.status || "queued";
  const isExecutionStarted = currentExecutionStatus === "running";
  const isExecutionLocked = currentExecutionStatus === "completed" || currentExecutionStatus === "failed";
  const canCreateExecution = Boolean(projectId && appTypeId && selectedSuiteIds.length);
  const selectedScopeSuites = useMemo(
    () => scopeSuites.filter((suite) => selectedSuiteIds.includes(suite.id)),
    [scopeSuites, selectedSuiteIds]
  );

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Executions"
        title="Test Executions"
        description="Create snapshot-based execution runs, monitor blockers quickly, and preserve suite and step context exactly as it existed when the run was opened."
        actions={<button className="primary-button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} type="button">Create Execution</button>}
      />

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

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

      <div className="two-column-grid execution-summary-grid">
        <Panel title="Create execution" subtitle="Choose a project, app type, and suite scope. QAira snapshots the selected suites at creation time.">
          <form className="form-grid" onSubmit={(event) => void handleCreateExecution(event)}>
            <FormField label="Execution name">
              <input value={executionName} onChange={(event) => setExecutionName(event.target.value)} />
            </FormField>

            <FormField label="Suite scope" required>
              <div className="selection-summary-card">
                <div className="selection-summary-header">
                  <div>
                    <strong>{selectedScopeSuites.length ? `${selectedScopeSuites.length} suites selected` : "No suites selected yet"}</strong>
                    <span>Choose one or more suites. The execution will preserve their cases and steps as a fixed snapshot.</span>
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

            {!scopeSuites.length && appTypeId ? <div className="empty-state compact">No suites available for this app type. Create a suite first.</div> : null}

            <button className="primary-button" disabled={!canCreateExecution || createExecution.isPending} type="submit">
              {createExecution.isPending ? "Creating…" : "Create execution"}
            </button>
          </form>
        </Panel>

        <Panel title="Run health" subtitle={selectedExecution ? "Current execution summary and immediate blockers." : "Create or select an execution to inspect its health."}>
          {selectedExecution ? (
            <div className="detail-stack">
              <div className="metric-strip">
                <div className="mini-card">
                  <strong>{executionProgress.percent}%</strong>
                  <span>{executionProgress.completedCases}/{executionProgress.totalCases} cases actioned</span>
                </div>
                <div className="mini-card">
                  <strong>{executionStatusCounts.failed}</strong>
                  <span>Failed cases</span>
                </div>
                <div className="mini-card">
                  <strong>{executionStatusCounts.blocked}</strong>
                  <span>Blocked cases</span>
                </div>
                <div className="mini-card">
                  <strong>{snapshotCases.length}</strong>
                  <span>Preserved snapshot cases</span>
                </div>
              </div>

              <div className="stack-list">
                {blockingCases.slice(0, 3).map((testCase) => (
                  <button className="stack-item stack-item-button" key={testCase.id} onClick={() => setSelectedTestCaseId(testCase.id)} type="button">
                    <div>
                      <strong>{testCase.title}</strong>
                      <span>{testCase.description || "Failure or block needs investigation."}</span>
                    </div>
                    <StatusBadge value={caseDerivedStatus(testCase)} />
                  </button>
                ))}
                {!blockingCases.length ? <div className="empty-state compact">No blockers are active in this run.</div> : null}
              </div>
            </div>
          ) : (
            <div className="empty-state compact">No execution selected yet.</div>
          )}
        </Panel>
      </div>

      <div className="execution-workspace">
        <div className="execution-column sticky-column">
          <Panel title="Execution list" subtitle="Search and switch between recent runs.">
            <div className="design-list-toolbar">
              <input
                aria-label="Search executions"
                value={executionSearch}
                onChange={(event) => setExecutionSearch(event.target.value)}
                type="search"
              />
            </div>

            {executionsQuery.isLoading ? (
              <div className="record-list">
                <div className="skeleton-block" />
                <div className="skeleton-block" />
                <div className="skeleton-block" />
              </div>
            ) : null}

            {!executionsQuery.isLoading ? (
              <VirtualList
                ariaLabel="Execution list"
                className="execution-list-virtual"
                emptyState={<div className="empty-state compact">No executions created yet.</div>}
                height={640}
                itemHeight={224}
                itemKey={(execution) => execution.id}
                items={filteredExecutions}
                renderItem={(execution: Execution) => (
                  <button
                    className={selectedExecution?.id === execution.id ? "record-card tile-card execution-card virtual-card is-active" : "record-card tile-card execution-card virtual-card"}
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
                        <span className="tile-metric">{executionSummaryById[execution.id]?.total || 0} results</span>
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
                )}
              />
            ) : null}
          </Panel>
        </div>

        <div className="execution-column">
          <Panel title="Suite tree" subtitle={selectedExecution ? "The center workspace for run scope and case selection." : "Select an execution to see its snapped scope."}>
            {selectedExecution ? (
              <div className="suite-tree">
                <div className="metric-strip">
                  <div className="mini-card">
                    <ProgressMeter
                      detail={`${executionStatusCounts.passed} passed · ${executionStatusCounts.failed} failed · ${executionStatusCounts.blocked} blocked`}
                      label="Execution progress"
                      segments={buildProgressSegments(
                        executionStatusCounts.passed,
                        executionStatusCounts.failed,
                        executionStatusCounts.blocked,
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
                    <strong>{selectedExecutionSuiteIds.length}</strong>
                    <span>Scoped suites</span>
                  </div>
                </div>

                {!executionSuites.length ? <div className="empty-state compact">No suites were selected for this execution.</div> : null}

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
                              <span className="tile-card-kicker">{suite.isHistorical ? "Historical suite snapshot" : "Execution snapshot scope"}</span>
                            </div>
                          </div>
                          <p className="tile-card-description">Expand the suite to inspect the snapped case set carried by this execution.</p>
                          <div className="tile-card-metrics">
                            <span className="tile-metric">{suiteMetric?.count || 0} cases</span>
                            <span className="tile-metric">{suiteMetric?.failedCount || 0} failed</span>
                            <span className="tile-metric">{suiteMetric?.blockedCount || 0} blocked</span>
                          </div>
                          <ProgressMeter
                            detail={`${suiteMetric?.passedCount || 0} passed · ${suiteMetric?.failedCount || 0} failed · ${suiteMetric?.blockedCount || 0} blocked`}
                            label="Suite completion"
                            segments={buildProgressSegments(
                              suiteMetric?.passedCount || 0,
                              suiteMetric?.failedCount || 0,
                              suiteMetric?.blockedCount || 0,
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
                                  <span className="tile-metric">Snapshot case</span>
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
              <div className="empty-state compact">Select an execution to inspect its snapshot scope.</div>
            )}
          </Panel>
        </div>

        <div className="execution-column">
          <Panel title="Execution detail" subtitle={selectedExecutionCase ? "Focused detail for the selected case." : "Select a case to view step execution and logs."}>
            {selectedExecution ? (
              <div className="detail-stack">
                <div className="detail-summary">
                  <strong>{selectedExecutionCase?.title || selectedExecution.name || "Unnamed execution"}</strong>
                  <span>{selectedExecutionCase?.description || "Snapshot detail for the selected execution item."}</span>
                  <span>Case status: {selectedExecutionCase ? caseDerivedStatus(selectedExecutionCase) : executionProgress.derivedStatus}</span>
                </div>

                <SubnavTabs
                  items={[
                    { value: "overview", label: "Overview", meta: `${selectedSteps.length} steps` },
                    { value: "logs", label: "Logs", meta: selectedExecutionResult?.status || "none" },
                    { value: "failures", label: "Failures", meta: `${blockingCases.length}` }
                  ]}
                  onChange={setActiveTab}
                  value={activeTab}
                />

                {activeTab === "overview" ? (
                  <div className="detail-stack">
                    <div className="action-row">
                      <button
                        className="ghost-button"
                        disabled={currentExecutionStatus !== "queued" || startExecution.isPending}
                        onClick={() => void startExecution.mutateAsync(selectedExecution.id).then(() => refreshExecutionScope()).catch((error: Error) => showError(error, "Unable to start execution"))}
                        type="button"
                      >
                        {startExecution.isPending ? "Starting…" : "Start execution"}
                      </button>
                      <button
                        className="ghost-button"
                        disabled={currentExecutionStatus !== "running" || completeExecution.isPending}
                        onClick={() => void completeExecution.mutateAsync({ id: selectedExecution.id, status: executionProgress.failedCount ? "failed" : "completed" }).then(() => refreshExecutionScope()).catch((error: Error) => showError(error, "Unable to complete execution"))}
                        type="button"
                      >
                        {completeExecution.isPending ? "Completing…" : "Complete execution"}
                      </button>
                    </div>

                    {selectedExecutionCase ? (
                      <div className="mini-card">
                        <ProgressMeter
                          detail={`${selectedStepProgress.passedCount} passed · ${selectedStepProgress.failedCount} failed · ${selectedStepProgress.pendingCount} pending`}
                          label="Step progress"
                          segments={buildProgressSegments(
                            selectedStepProgress.passedCount,
                            selectedStepProgress.failedCount,
                            0,
                            selectedSteps.length
                          )}
                          value={selectedStepProgress.percent}
                        />
                      </div>
                    ) : null}

                    {!selectedExecutionCase ? <div className="empty-state compact">Select a case from the suite tree to run its steps.</div> : null}
                    {selectedExecutionCase && !selectedSteps.length ? <div className="empty-state compact">No snapshot steps are available for this case.</div> : null}

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
                ) : null}

                {activeTab === "logs" ? (
                  <div className="stack-list">
                    {selectedExecutionResult ? (
                      <div className="detail-summary">
                        <strong>{selectedExecutionResult.test_case_title || selectedExecutionCase?.title || "Selected case logs"}</strong>
                        <span>{selectedExecutionResult.logs || "No logs were captured for this case yet."}</span>
                        <span>{selectedExecutionResult.error || "No explicit error recorded."}</span>
                      </div>
                    ) : (
                      <div className="empty-state compact">No logs yet for the selected case.</div>
                    )}

                    {executionResults.map((result) => (
                      <div className="stack-item" key={result.id}>
                        <div>
                          <strong>{result.test_case_title || result.test_case_id}</strong>
                          <span>{result.logs || result.error || "No logs available."}</span>
                        </div>
                        <StatusBadge value={result.status} />
                      </div>
                    ))}
                    {!executionResults.length ? <div className="empty-state compact">No execution results have been logged yet.</div> : null}
                  </div>
                ) : null}

                {activeTab === "failures" ? (
                  <div className="stack-list">
                    {blockingCases.map((testCase) => (
                      <button className="stack-item stack-item-button" key={testCase.id} onClick={() => setSelectedTestCaseId(testCase.id)} type="button">
                        <div>
                          <strong>{testCase.title}</strong>
                          <span>{testCase.description || "Blocked or failed case."}</span>
                        </div>
                        <StatusBadge value={caseDerivedStatus(testCase)} />
                      </button>
                    ))}
                    {!blockingCases.length ? <div className="empty-state compact">No failed or blocked cases in this execution.</div> : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-state compact">Select an execution to continue.</div>
            )}
          </Panel>
        </div>
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
            <p>Choose the suites to include in this execution. QAira snapshots them immediately when the run is created.</p>
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
            <button className="ghost-button" onClick={onClose} type="button">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
