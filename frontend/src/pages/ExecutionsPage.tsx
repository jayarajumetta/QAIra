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
import { useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import {
  deriveCaseStatusFromSteps,
  parseExecutionLogs,
  stringifyExecutionLogs,
  type ExecutionStepStatus
} from "../lib/executionLogs";
import type { AppType, Execution, ExecutionCaseSnapshot, ExecutionResult, ExecutionStepSnapshot, Project, TestStep, TestSuite } from "../types";

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
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useState("");
  const [selectedSuiteIds, setSelectedSuiteIds] = useState<string[]>([]);
  const [isCreateExecutionModalOpen, setIsCreateExecutionModalOpen] = useState(false);
  const [isSuitePickerOpen, setIsSuitePickerOpen] = useState(false);
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const [expandedSuiteIds, setExpandedSuiteIds] = useState<string[]>([]);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [bulkSelectedStepIds, setBulkSelectedStepIds] = useState<string[]>([]);
  const [executionName, setExecutionName] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [activeTab, setActiveTab] = useState<ExecutionTab>("overview");
  const [executionSearch, setExecutionSearch] = useState("");
  const [isExecutionListMinimized, setIsExecutionListMinimized] = useState(false);
  const [isSuiteTreeMinimized, setIsSuiteTreeMinimized] = useState(false);
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
  const selectedProject = projects.find((project) => project.id === projectId) || null;
  const selectedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const closeCreateExecutionModal = () => {
    setIsCreateExecutionModalOpen(false);
    setIsSuitePickerOpen(false);
  };

  useEffect(() => {
    if (projectsQuery.isPending) {
      return;
    }

    if (!projects.length) {
      if (projectId) {
        setProjectId("");
      }
      return;
    }

    if (!projects.some((project) => project.id === projectId)) {
      setProjectId(projects[0].id);
    }
  }, [projectId, projects, projectsQuery.isPending, setProjectId]);

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
    setBulkSelectedStepIds([]);
    setActiveTab("overview");
  }, [selectedExecutionId, selectedTestCaseId]);

  const resultByCaseId = useMemo(() => {
    const map: Record<string, ExecutionResult> = {};
    executionResults.forEach((result) => {
      map[result.test_case_id] = result;
    });
    return map;
  }, [executionResults]);

  const selectedCaseLogs = useMemo(
    () => parseExecutionLogs(resultByCaseId[selectedTestCaseId]?.logs || null),
    [resultByCaseId, selectedTestCaseId]
  );

  const stepStatuses = selectedCaseLogs.stepStatuses || {};
  const stepNotes = selectedCaseLogs.stepNotes || {};

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
      setIsCreateExecutionModalOpen(false);
      showSuccess("Execution created from a snapshot of the selected suites.");
      await refreshExecutionScope(response.id);
    } catch (error) {
      showError(error, "Unable to create execution");
    }
  };

  const persistCaseResult = async (
    testCaseId: string,
    patches: { stepStatusesPatch?: Record<string, ExecutionStepStatus>; stepNotesPatch?: Record<string, string> }
  ) => {
    const scopedAppTypeId = selectedExecution?.app_type_id;
    const currentCaseSnapshot = snapshotCases.find((snapshot) => snapshot.test_case_id === testCaseId);

    if (!selectedExecution || !testCaseId || !scopedAppTypeId || !currentCaseSnapshot) {
      return;
    }

    const fresh =
      queryClient.getQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id]) || executionResults;
    const existing = fresh.find((item) => item.test_case_id === testCaseId);
    const prev = parseExecutionLogs(existing?.logs || null);
    const mergedStatuses = { ...(prev.stepStatuses || {}), ...(patches.stepStatusesPatch || {}) };
    const mergedNotes = { ...(prev.stepNotes || {}), ...(patches.stepNotesPatch || {}) };

    const caseStepIds = (stepsByCaseId[testCaseId] || [])
      .slice()
      .sort((left, right) => left.step_order - right.step_order)
      .map((step) => step.id);
    const aggregateStatus = deriveCaseStatusFromSteps(caseStepIds, mergedStatuses);
    const logs = stringifyExecutionLogs({ stepStatuses: mergedStatuses, stepNotes: mergedNotes });

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
            ? {
                ...item,
                status: aggregateStatus,
                logs,
                error: aggregateStatus === "failed" ? "Step failed during execution" : null
              }
            : item
        )
      );
      return;
    }

    const shouldCreate =
      Object.keys(patches.stepStatusesPatch || {}).length > 0 || Object.keys(patches.stepNotesPatch || {}).length > 0;
    if (!shouldCreate) {
      return;
    }

    const response = await createResult.mutateAsync({
      execution_id: selectedExecution.id,
      test_case_id: testCaseId,
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
        test_case_id: testCaseId,
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
  };

  const handleRecordStep = async (stepId: string, status: "passed" | "failed") => {
    if (!selectedExecution || !selectedTestCaseId) {
      return;
    }

    const updatedStepStatuses = { ...stepStatuses, [stepId]: status };
    const currentSteps = selectedSteps.map((step) => step.id);
    const allResolved = currentSteps.length > 0 && currentSteps.every((id) => updatedStepStatuses[id]);

    try {
      await persistCaseResult(selectedTestCaseId, { stepStatusesPatch: { [stepId]: status } });
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

  const handleSaveStepNote = async (stepId: string, note: string) => {
    if (!selectedExecution || !selectedTestCaseId) {
      return;
    }

    try {
      await persistCaseResult(selectedTestCaseId, { stepNotesPatch: { [stepId]: note } });
    } catch (error) {
      showError(error, "Unable to save step note");
    }
  };

  const handleBulkStepStatus = async (status: "passed" | "failed", scope: "selected" | "all") => {
    if (!selectedExecution || !selectedTestCaseId || !selectedSteps.length) {
      return;
    }

    const targetIds =
      scope === "all"
        ? selectedSteps.map((step) => step.id)
        : bulkSelectedStepIds.filter((id) => selectedSteps.some((step) => step.id === id));

    if (!targetIds.length) {
      showError(null, scope === "selected" ? "Select at least one step." : "No steps to update.");
      return;
    }

    const patch = targetIds.reduce<Record<string, ExecutionStepStatus>>((acc, id) => {
      acc[id] = status;
      return acc;
    }, {});

    try {
      await persistCaseResult(selectedTestCaseId, { stepStatusesPatch: patch });
      setBulkSelectedStepIds([]);
      showSuccess(`${targetIds.length} step${targetIds.length === 1 ? "" : "s"} marked ${status}.`);
    } catch (error) {
      showError(error, "Unable to update steps");
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

  const persistCaseOutcomeOnly = async (testCaseId: string, status: "passed" | "failed") => {
    const scopedAppTypeId = selectedExecution?.app_type_id;
    const currentCaseSnapshot = snapshotCases.find((snapshot) => snapshot.test_case_id === testCaseId);
    if (!selectedExecution || !scopedAppTypeId || !currentCaseSnapshot) {
      return;
    }

    const fresh =
      queryClient.getQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id]) || executionResults;
    const existing = fresh.find((item) => item.test_case_id === testCaseId);
    const prev = parseExecutionLogs(existing?.logs || null);
    const logs = stringifyExecutionLogs({ stepStatuses: prev.stepStatuses || {}, stepNotes: prev.stepNotes || {} });

    if (existing) {
      await updateResult.mutateAsync({
        id: existing.id,
        input: {
          status,
          logs,
          error: status === "failed" ? "Marked at suite level" : ""
        }
      });
      queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) =>
        current.map((item) =>
          item.id === existing.id
            ? { ...item, status, logs, error: status === "failed" ? "Marked at suite level" : null }
            : item
        )
      );
      return;
    }

    const response = await createResult.mutateAsync({
      execution_id: selectedExecution.id,
      test_case_id: testCaseId,
      app_type_id: scopedAppTypeId,
      status,
      logs,
      error: status === "failed" ? "Marked at suite level" : undefined,
      executed_by: session!.user.id
    });

    queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) => [
      {
        id: response.id,
        execution_id: selectedExecution.id,
        test_case_id: testCaseId,
        test_case_title: currentCaseSnapshot.test_case_title,
        suite_id: currentCaseSnapshot.suite_id,
        suite_name: currentCaseSnapshot.suite_name,
        app_type_id: scopedAppTypeId,
        status,
        duration_ms: null,
        error: status === "failed" ? "Marked at suite level" : null,
        logs,
        executed_by: session!.user.id
      },
      ...current
    ]);
  };

  const handleSuiteBulkStatus = async (suiteId: string, status: "passed" | "failed") => {
    if (!selectedExecution || !isExecutionStarted || isExecutionLocked) {
      return;
    }

    const suiteCases = displayCasesBySuiteId[suiteId] || [];
    if (!suiteCases.length) {
      return;
    }

    try {
      for (const testCase of suiteCases) {
        const steps = stepsByCaseId[testCase.id] || [];
        if (steps.length) {
          const patch = steps.reduce<Record<string, ExecutionStepStatus>>((acc, step) => {
            acc[step.id] = status;
            return acc;
          }, {});
          await persistCaseResult(testCase.id, { stepStatusesPatch: patch });
        } else {
          await persistCaseOutcomeOnly(testCase.id, status);
        }
      }

      await refreshExecutionScope();
      showSuccess(`Suite marked ${status} for all cases.`);
    } catch (error) {
      showError(error, "Unable to update suite");
    }
  };

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Executions"
        title="Test Executions"
        actions={
          <button className="primary-button" onClick={() => setIsCreateExecutionModalOpen(true)} type="button">
            Create Execution
          </button>
        }
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

      <Panel
        title="Run health"
        subtitle={selectedExecution ? "Current execution summary and immediate blockers." : "Create or select an execution to inspect its health."}
      >
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
          <div className="empty-state compact">No execution selected yet. Open the create dialog to start a new run.</div>
        )}
      </Panel>

      <div
        className={[
          "execution-workspace",
          isExecutionListMinimized ? "execution-workspace--list-minimized" : "",
          isSuiteTreeMinimized ? "execution-workspace--tree-minimized" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={isExecutionListMinimized ? "execution-column execution-column--collapsed" : "execution-column sticky-column"}>
          {isExecutionListMinimized ? (
            <ExecutionMinimizedRail
              count={filteredExecutions.length}
              label="Execution list"
              onExpand={() => setIsExecutionListMinimized(false)}
            />
          ) : (
            <Panel
              actions={
                <button className="ghost-button execution-panel-toggle" onClick={() => setIsExecutionListMinimized(true)} type="button">
                  Minimize
                </button>
              }
              title="Execution list"
              subtitle="Search and switch between recent runs."
            >
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
          )}
        </div>

        <div className={isSuiteTreeMinimized ? "execution-column execution-column--collapsed" : "execution-column"}>
          {isSuiteTreeMinimized ? (
            <ExecutionMinimizedRail
              count={selectedExecutionSuiteIds.length}
              label="Suite tree"
              onExpand={() => setIsSuiteTreeMinimized(false)}
            />
          ) : (
            <Panel
              actions={
                <button className="ghost-button execution-panel-toggle" onClick={() => setIsSuiteTreeMinimized(true)} type="button">
                  Minimize
                </button>
              }
              title="Suite tree"
              subtitle={selectedExecution ? "The center workspace for run scope and case selection." : "Select an execution to see its snapped scope."}
            >
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
                        <div className={isExpanded ? "tree-suite-row record-card tile-card is-active" : "tree-suite-row record-card tile-card"}>
                          <button
                            className="tree-suite-expand"
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
                              <p className="tile-card-description">Expand the suite to inspect cases. Use suite pass/fail to set every case in this suite at once.</p>
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
                          </button>
                          <div className="tree-suite-bulk-actions" role="group" aria-label={`${suite.name} suite-level results`}>
                            <button
                              className="ghost-button suite-bulk-pass"
                              disabled={!isExecutionStarted || isExecutionLocked}
                              onClick={() => void handleSuiteBulkStatus(suite.id, "passed")}
                              type="button"
                            >
                              Suite pass
                            </button>
                            <button
                              className="ghost-button danger suite-bulk-fail"
                              disabled={!isExecutionStarted || isExecutionLocked}
                              onClick={() => void handleSuiteBulkStatus(suite.id, "failed")}
                              type="button"
                            >
                              Suite fail
                            </button>
                          </div>
                        </div>

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
          )}
        </div>

        <div className="execution-column execution-column--detail">
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
                      <div className="execution-steps-toolbar">
                        <label className="execution-select-all">
                          <input
                            checked={selectedSteps.length > 0 && bulkSelectedStepIds.length === selectedSteps.length}
                            onChange={() => {
                              if (bulkSelectedStepIds.length === selectedSteps.length) {
                                setBulkSelectedStepIds([]);
                              } else {
                                setBulkSelectedStepIds(selectedSteps.map((step) => step.id));
                              }
                            }}
                            type="checkbox"
                          />
                          <span>Select all steps</span>
                        </label>
                        <div className="execution-steps-bulk-buttons">
                          <button
                            className="ghost-button"
                            disabled={!isExecutionStarted || isExecutionLocked || !bulkSelectedStepIds.length}
                            onClick={() => void handleBulkStepStatus("passed", "selected")}
                            type="button"
                          >
                            Pass selected
                          </button>
                          <button
                            className="ghost-button danger"
                            disabled={!isExecutionStarted || isExecutionLocked || !bulkSelectedStepIds.length}
                            onClick={() => void handleBulkStepStatus("failed", "selected")}
                            type="button"
                          >
                            Fail selected
                          </button>
                          <button
                            className="ghost-button"
                            disabled={!isExecutionStarted || isExecutionLocked}
                            onClick={() => void handleBulkStepStatus("passed", "all")}
                            type="button"
                          >
                            Pass all steps
                          </button>
                          <button
                            className="ghost-button danger"
                            disabled={!isExecutionStarted || isExecutionLocked}
                            onClick={() => void handleBulkStepStatus("failed", "all")}
                            type="button"
                          >
                            Fail all steps
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="execution-step-table" role="table" aria-label="Test steps for this case">
                      <div className="execution-step-table-head" role="row">
                        <span className="execution-step-col-check" role="columnheader" />
                        <span className="execution-step-col-order" role="columnheader">
                          #
                        </span>
                        <span className="execution-step-col-action" role="columnheader">
                          Action
                        </span>
                        <span className="execution-step-col-expected" role="columnheader">
                          Expected
                        </span>
                        <span className="execution-step-col-status" role="columnheader">
                          Result
                        </span>
                        <span className="execution-step-col-actions" role="columnheader">
                          Mark
                        </span>
                        <span className="execution-step-col-note" role="columnheader">
                          Comment / log
                        </span>
                      </div>
                      <div className="execution-step-table-body">
                        {selectedSteps.map((step) => {
                          const rowStatus = stepStatuses[step.id];
                          return (
                            <ExecutionCompactStepRow
                              key={step.id}
                              isLocked={!isExecutionStarted || isExecutionLocked}
                              isSelected={bulkSelectedStepIds.includes(step.id)}
                              note={stepNotes[step.id] || ""}
                              onFail={() => void handleRecordStep(step.id, "failed")}
                              onNoteBlur={(value) => void handleSaveStepNote(step.id, value)}
                              onPass={() => void handleRecordStep(step.id, "passed")}
                              onToggleSelect={(checked) =>
                                setBulkSelectedStepIds((current) =>
                                  checked ? [...new Set([...current, step.id])] : current.filter((id) => id !== step.id)
                                )
                              }
                              status={rowStatus || "queued"}
                              step={step}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {!isExecutionStarted && !isExecutionLocked ? <div className="empty-state compact">Start the execution to enable step actions.</div> : null}
                    {isExecutionLocked ? <div className="empty-state compact">This execution is locked because it has been completed.</div> : null}
                  </div>
                ) : null}

                {activeTab === "logs" ? (
                  <div className="stack-list execution-logs-stack">
                    {selectedExecutionResult ? (
                      <div className="detail-summary execution-logs-case">
                        <strong>{selectedExecutionResult.test_case_title || selectedExecutionCase?.title || "Selected case logs"}</strong>
                        {selectedExecutionResult.error ? <span className="execution-log-error">{selectedExecutionResult.error}</span> : null}
                        <ExecutionStructuredLogView logsJson={selectedExecutionResult.logs} steps={selectedSteps} />
                      </div>
                    ) : (
                      <div className="empty-state compact">No logs yet for the selected case.</div>
                    )}

                    {executionResults
                      .filter((result) => result.id !== selectedExecutionResult?.id)
                      .map((result) => (
                        <div className="stack-item execution-log-row" key={result.id}>
                          <div>
                            <strong>{result.test_case_title || result.test_case_id}</strong>
                            <ExecutionStructuredLogSummary logsJson={result.logs} />
                            {result.error ? <span className="execution-log-error">{result.error}</span> : null}
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

      {isCreateExecutionModalOpen ? (
        <ExecutionCreateModal
          appTypeId={appTypeId}
          appTypes={appTypes}
          canCreateExecution={canCreateExecution}
          executionName={executionName}
          isSubmitting={createExecution.isPending}
          onAppTypeChange={(value) => {
            setAppTypeId(value);
            setSelectedSuiteIds([]);
            setIsSuitePickerOpen(false);
          }}
          onClose={closeCreateExecutionModal}
          onExecutionNameChange={setExecutionName}
          onProjectChange={setProjectId}
          onRemoveSuite={(suiteId) => setSelectedSuiteIds((current) => current.filter((id) => id !== suiteId))}
          onSelectSuites={() => setIsSuitePickerOpen(true)}
          onSubmit={(event) => void handleCreateExecution(event)}
          projectId={projectId}
          projects={projects}
          scopeSuites={scopeSuites}
          selectedAppType={selectedAppType?.name || ""}
          selectedProject={selectedProject?.name || ""}
          selectedScopeSuites={selectedScopeSuites}
        />
      ) : null}

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

function ExecutionCompactStepRow({
  step,
  status,
  note,
  isLocked,
  isSelected,
  onToggleSelect,
  onPass,
  onFail,
  onNoteBlur
}: {
  step: TestStep;
  status: ExecutionResult["status"] | "queued";
  note: string;
  isLocked: boolean;
  isSelected: boolean;
  onToggleSelect: (checked: boolean) => void;
  onPass: () => void;
  onFail: () => void;
  onNoteBlur: (value: string) => void;
}) {
  const toneClass =
    status === "passed" ? "execution-step-row is-passed" : status === "failed" ? "execution-step-row is-failed" : "execution-step-row";

  return (
    <div className={toneClass} role="row">
      <span className="execution-step-col-check" role="cell">
        <input
          aria-label={`Select step ${step.step_order}`}
          checked={isSelected}
          disabled={isLocked}
          onChange={(event) => onToggleSelect(event.target.checked)}
          type="checkbox"
        />
      </span>
      <span className="execution-step-col-order" role="cell">
        {step.step_order}
      </span>
      <span className="execution-step-col-action execution-step-clamp" role="cell" title={step.action || ""}>
        {step.action || "—"}
      </span>
      <span className="execution-step-col-expected execution-step-clamp" role="cell" title={step.expected_result || ""}>
        {step.expected_result || "—"}
      </span>
      <span className="execution-step-col-status" role="cell">
        <StatusBadge value={status} />
      </span>
      <span className="execution-step-col-actions" role="cell">
        <div className="execution-step-mark-buttons">
          <button className="primary-button execution-step-pass" disabled={isLocked} onClick={onPass} type="button">
            Pass
          </button>
          <button className="ghost-button danger execution-step-fail" disabled={isLocked} onClick={onFail} type="button">
            Fail
          </button>
        </div>
      </span>
      <span className="execution-step-col-note" role="cell">
        <textarea
          className="execution-step-note-input"
          defaultValue={note}
          disabled={isLocked}
          key={`${step.id}:${note}`}
          onBlur={(event) => {
            const raw = event.target.value;
            if (raw.trim() !== (note || "").trim()) {
              onNoteBlur(raw);
            }
          }}
          placeholder="Evidence, defect ID, observations…"
          rows={2}
        />
      </span>
    </div>
  );
}

function ExecutionStructuredLogView({ logsJson, steps }: { logsJson: string | null; steps: TestStep[] }) {
  const parsed = parseExecutionLogs(logsJson);
  const hasNotes = parsed.stepNotes && Object.keys(parsed.stepNotes).length > 0;
  const hasStatuses = parsed.stepStatuses && Object.keys(parsed.stepStatuses).length > 0;

  if (!hasNotes && !hasStatuses && !logsJson?.trim()) {
    return <span className="execution-log-empty">No structured step data recorded yet.</span>;
  }

  const rows = steps
    .map((step) => {
      const st = parsed.stepStatuses?.[step.id];
      const nt = parsed.stepNotes?.[step.id];
      if (!st && !nt) {
        return null;
      }
      return (
        <div className="execution-structured-log-row" key={step.id}>
          <strong>Step {step.step_order}</strong>
          {st ? <StatusBadge value={st} /> : null}
          {nt ? <span className="execution-structured-note">{nt}</span> : null}
        </div>
      );
    })
    .filter(Boolean);

  return (
    <div className="execution-structured-log">
      {rows.length ? rows : null}
      {!rows.length && logsJson?.trim() ? <pre className="execution-log-raw">{logsJson}</pre> : null}
    </div>
  );
}

function ExecutionStructuredLogSummary({ logsJson }: { logsJson: string | null }) {
  const parsed = parseExecutionLogs(logsJson);
  const noteCount = parsed.stepNotes ? Object.values(parsed.stepNotes).filter(Boolean).length : 0;
  const statusCount = parsed.stepStatuses ? Object.keys(parsed.stepStatuses).length : 0;
  if (!noteCount && !statusCount) {
    return <span className="execution-log-summary-muted">No step details</span>;
  }
  return (
    <span className="execution-log-summary">
      {statusCount ? `${statusCount} step result${statusCount === 1 ? "" : "s"}` : null}
      {statusCount && noteCount ? " · " : null}
      {noteCount ? `${noteCount} note${noteCount === 1 ? "" : "s"}` : null}
    </span>
  );
}

function ExecutionMinimizedRail({
  label,
  count,
  onExpand
}: {
  label: string;
  count?: number;
  onExpand: () => void;
}) {
  return (
    <button aria-label={`Expand ${label}`} className="execution-panel-rail" onClick={onExpand} type="button">
      <span className="execution-panel-rail-label">{label}</span>
      <span className="execution-panel-rail-meta">{typeof count === "number" ? count : "Show"}</span>
    </button>
  );
}

function ExecutionCreateModal({
  projects,
  projectId,
  onProjectChange,
  appTypes,
  appTypeId,
  onAppTypeChange,
  selectedProject,
  selectedAppType,
  scopeSuites,
  selectedScopeSuites,
  executionName,
  onExecutionNameChange,
  onSelectSuites,
  onRemoveSuite,
  canCreateExecution,
  isSubmitting,
  onClose,
  onSubmit
}: {
  projects: Project[];
  projectId: string;
  onProjectChange: (value: string) => void;
  appTypes: AppType[];
  appTypeId: string;
  onAppTypeChange: (value: string) => void;
  selectedProject: string;
  selectedAppType: string;
  scopeSuites: TestSuite[];
  selectedScopeSuites: TestSuite[];
  executionName: string;
  onExecutionNameChange: (value: string) => void;
  onSelectSuites: () => void;
  onRemoveSuite: (suiteId: string) => void;
  canCreateExecution: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={() => !isSubmitting && onClose()} role="presentation">
      <div
        aria-labelledby="create-execution-title"
        aria-modal="true"
        className="modal-card execution-create-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <form className="execution-create-form" onSubmit={onSubmit}>
          <div className="execution-create-header">
            <div className="execution-create-title">
              <p className="eyebrow">Executions</p>
              <h3 id="create-execution-title">Create execution</h3>
              <p>Choose the project, app type, and suite scope to snapshot into a new run.</p>
            </div>
            <button
              aria-label="Close create execution dialog"
              className="ghost-button"
              disabled={isSubmitting}
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          </div>

          <div className="execution-create-body">
            <div className="execution-create-grid">
              <FormField label="Project" required>
                <select value={projectId} onChange={(event) => onProjectChange(event.target.value)}>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="App type" required>
                <select disabled={!projectId} value={appTypeId} onChange={(event) => onAppTypeChange(event.target.value)}>
                  {appTypes.length ? null : <option value="">No app types</option>}
                  {appTypes.map((appType) => (
                    <option key={appType.id} value={appType.id}>
                      {appType.name}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>

            <FormField label="Execution name">
              <input value={executionName} onChange={(event) => onExecutionNameChange(event.target.value)} />
            </FormField>

            <div className="detail-summary">
              <strong>{selectedProject || "Select a project to continue"}</strong>
              <span>{selectedAppType ? `${selectedAppType} app type selected for this snapshot.` : "Choose an app type to load suite scope."}</span>
              <span>{scopeSuites.length ? `${scopeSuites.length} suites available in the current scope.` : "No suites available in the current scope yet."}</span>
            </div>

            <FormField label="Suite scope" required>
              <div className="selection-summary-card">
                <div className="selection-summary-header">
                  <div>
                    <strong>{selectedScopeSuites.length ? `${selectedScopeSuites.length} suites selected` : "No suites selected yet"}</strong>
                    <span>Choose one or more suites. The execution will preserve their cases and steps as a fixed snapshot.</span>
                  </div>
                  <button className="ghost-button" disabled={!scopeSuites.length} onClick={onSelectSuites} type="button">
                    Select suites
                  </button>
                </div>

                {selectedScopeSuites.length ? (
                  <div className="selection-chip-row">
                    {selectedScopeSuites.map((suite) => (
                      <button key={suite.id} className="selection-chip" onClick={() => onRemoveSuite(suite.id)} type="button">
                        {suite.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </FormField>

            {!scopeSuites.length && appTypeId ? <div className="empty-state compact">No suites available for this app type. Create a suite first.</div> : null}
          </div>

          <div className="action-row execution-create-actions">
            <button className="primary-button" disabled={!canCreateExecution || isSubmitting} type="submit">
              {isSubmitting ? "Creating…" : "Create execution"}
            </button>
            <button className="ghost-button" disabled={isSubmitting} onClick={onClose} type="button">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
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
