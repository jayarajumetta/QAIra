import { FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { ExecutionContextSelector } from "../components/ExecutionContextSelector";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ProjectDropdown } from "../components/ProjectDropdown";
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
import type { AppType, Execution, ExecutionCaseSnapshot, ExecutionResult, ExecutionStatus, ExecutionStepSnapshot, Project, TestStep, TestSuite } from "../types";

type ExecutionTab = "overview" | "logs" | "failures" | "history";

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
  suite_name: string | null;
  suite_ids: string[];
  sort_order: number;
};

type ExecutionRunSummary = {
  passed: number;
  failed: number;
  blocked: number;
  total: number;
  passRate: number;
  avgDurationMs: number | null;
  timedCount: number;
  latestActivityAt: string | null;
  totalDurationMs: number;
};

const EMPTY_EXECUTION_RUN_SUMMARY: ExecutionRunSummary = {
  passed: 0,
  failed: 0,
  blocked: 0,
  total: 0,
  passRate: 0,
  avgDurationMs: null,
  timedCount: 0,
  latestActivityAt: null,
  totalDurationMs: 0
};

const EXECUTION_STATUS_META: Record<ExecutionStatus, { label: string; description: string }> = {
  queued: {
    label: "Queued",
    description: "Run is ready to start."
  },
  running: {
    label: "Running",
    description: "Run is actively capturing evidence."
  },
  completed: {
    label: "Completed",
    description: "Run finished successfully."
  },
  failed: {
    label: "Failed",
    description: "Run finished with one or more failures."
  },
  aborted: {
    label: "Aborted",
    description: "Run stopped before normal completion."
  }
};

function normalizeExecutionStatus(status: Execution["status"] | null | undefined): ExecutionStatus {
  if (status === "running" || status === "completed" || status === "failed" || status === "aborted") {
    return status;
  }

  return "queued";
}

function executionStatusLabel(status: Execution["status"] | null | undefined) {
  return EXECUTION_STATUS_META[normalizeExecutionStatus(status)].label;
}

function executionStatusTooltip(status: Execution["status"] | null | undefined) {
  const { label, description } = EXECUTION_STATUS_META[normalizeExecutionStatus(status)];
  return `${label}: ${description}`;
}

function toCaseView(snapshot: ExecutionCaseSnapshot): ExecutionCaseView {
  return {
    id: snapshot.test_case_id,
    title: snapshot.test_case_title,
    description: snapshot.test_case_description,
    priority: snapshot.priority,
    status: snapshot.status,
    suite_id: snapshot.suite_id,
    suite_name: snapshot.suite_name,
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

const executionDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

function toTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function formatExecutionTimestamp(value?: string | null, fallback = "Not recorded") {
  const timestamp = toTimestamp(value);
  return timestamp ? executionDateTimeFormatter.format(timestamp) : fallback;
}

function computeExecutionDurationMs(
  startedAt?: string | null,
  endedAt?: string | null,
  now = Date.now()
) {
  const start = toTimestamp(startedAt);

  if (!start) {
    return null;
  }

  const end = toTimestamp(endedAt) || now;
  return Math.max(end - start, 0);
}

function formatDuration(ms?: number | null, fallback = "No duration") {
  if (ms == null || Number.isNaN(ms)) {
    return fallback;
  }

  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function averageDuration(values: Array<number | null | undefined>) {
  const scoped = values.filter((value): value is number => typeof value === "number" && !Number.isNaN(value));

  if (!scoped.length) {
    return null;
  }

  return Math.round(scoped.reduce((sum, value) => sum + value, 0) / scoped.length);
}

export function ExecutionsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId] = useState("");
  const [selectedExecutionConfigurationId, setSelectedExecutionConfigurationId] = useState("");
  const [selectedExecutionDataSetId, setSelectedExecutionDataSetId] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [activeTab, setActiveTab] = useState<ExecutionTab>("overview");
  const [executionSearch, setExecutionSearch] = useState("");
  const [isExecutionListMinimized, setIsExecutionListMinimized] = useState(false);
  const [isSuiteTreeMinimized, setIsSuiteTreeMinimized] = useState(false);
  const [isExecutionHealthExpanded, setIsExecutionHealthExpanded] = useState(true);
  const [isExecutionSupportExpanded, setIsExecutionSupportExpanded] = useState(true);
  const [liveNow, setLiveNow] = useState(() => Date.now());
  const [executionListItemHeight, setExecutionListItemHeight] = useState(236);
  const [caseTimerStartedAtById, setCaseTimerStartedAtById] = useState<Record<string, number>>({});
  const executionCardMeasureRef = useRef<HTMLDivElement | null>(null);
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
    mutationFn: ({ id, status }: { id: string; status: "completed" | "failed" | "aborted" }) => api.executions.complete(id, { status })
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
  const projectNameById = useMemo(
    () =>
      projects.reduce<Record<string, string>>((accumulator, project) => {
        accumulator[project.id] = project.name;
        return accumulator;
      }, {}),
    [projects]
  );
  const appTypeNameById = useMemo(
    () =>
      appTypes.reduce<Record<string, string>>((accumulator, appType) => {
        accumulator[appType.id] = appType.name;
        return accumulator;
      }, {}),
    [appTypes]
  );

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

  const resetExecutionContextSelection = () => {
    setSelectedExecutionEnvironmentId("");
    setSelectedExecutionConfigurationId("");
    setSelectedExecutionDataSetId("");
  };

  const closeExecutionBuilder = () => {
    closeCreateExecutionModal();
    setExecutionName("");
    resetExecutionContextSelection();
  };

  const syncExecutionSearchParams = (executionId: string, testCaseId?: string | null) => {
    const currentExecutionId = searchParams.get("execution") || "";
    const currentTestCaseId = searchParams.get("testCase") || "";
    const nextTestCaseId = testCaseId || "";

    if (currentExecutionId === executionId && currentTestCaseId === nextTestCaseId) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);

    if (executionId) {
      nextParams.set("execution", executionId);
    } else {
      nextParams.delete("execution");
    }

    if (testCaseId) {
      nextParams.set("testCase", testCaseId);
    } else {
      nextParams.delete("testCase");
    }

    setSearchParams(nextParams, { replace: true });
  };

  const focusExecution = (executionId: string) => {
    setSelectedExecutionId(executionId);
    setSelectedTestCaseId("");
    syncExecutionSearchParams(executionId, null);
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
      resetExecutionContextSelection();
      return;
    }

    if (!appTypes.some((item) => item.id === appTypeId)) {
      setAppTypeId(appTypes[0].id);
      setSelectedSuiteIds([]);
      resetExecutionContextSelection();
    }
  }, [appTypeId, appTypes]);

  useEffect(() => {
    const requestedExecutionId = searchParams.get("execution");

    if (requestedExecutionId) {
      if (selectedExecutionId !== requestedExecutionId) {
        setSelectedExecutionId(requestedExecutionId);
      }
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
  const currentExecutionStatus = normalizeExecutionStatus(selectedExecution?.status);
  const isExecutionStarted = currentExecutionStatus === "running";
  const isExecutionLocked =
    currentExecutionStatus === "completed" || currentExecutionStatus === "failed" || currentExecutionStatus === "aborted";
  const snapshotCases = useMemo(
    () => ((selectedExecution?.case_snapshots || []).slice().sort((left, right) => left.sort_order - right.sort_order)),
    [selectedExecution?.case_snapshots]
  );
  const snapshotSteps = selectedExecution?.step_snapshots || [];

  useEffect(() => {
    if (currentExecutionStatus !== "running") {
      setLiveNow(Date.now());
      return;
    }

    const timer = window.setInterval(() => setLiveNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [currentExecutionStatus, selectedExecutionId]);

  useEffect(() => {
    setCaseTimerStartedAtById({});
  }, [selectedExecutionId]);

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
    const requestedTestCaseId = searchParams.get("testCase");

    if (requestedTestCaseId && executionCaseOrder.some((testCase) => testCase.id === requestedTestCaseId)) {
      const requestedSuiteId = executionCaseOrder.find((testCase) => testCase.id === requestedTestCaseId)?.suite_id;

      if (requestedSuiteId) {
        setExpandedSuiteIds((current) => (current.includes(requestedSuiteId) ? current : [...current, requestedSuiteId]));
      }

      if (selectedTestCaseId !== requestedTestCaseId) {
        setSelectedTestCaseId(requestedTestCaseId);
      }
      return;
    }

    if (selectedTestCaseId && executionCaseOrder.some((testCase) => testCase.id === selectedTestCaseId)) {
      return;
    }

    setSelectedTestCaseId(executionCaseOrder[0]?.id || "");
  }, [executionCaseOrder, searchParams, selectedTestCaseId]);

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

  const caseDerivedStatus = (testCase: ExecutionCaseView): ExecutionResult["status"] | "queued" => {
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
    const summary: Record<string, ExecutionRunSummary> = {};

    allExecutionResults.forEach((result) => {
      summary[result.execution_id] = summary[result.execution_id] || { ...EMPTY_EXECUTION_RUN_SUMMARY };
      summary[result.execution_id].total += 1;
      if (result.status === "passed") {
        summary[result.execution_id].passed += 1;
      } else if (result.status === "failed") {
        summary[result.execution_id].failed += 1;
      } else if (result.status === "blocked") {
        summary[result.execution_id].blocked += 1;
      }

      if (typeof result.duration_ms === "number") {
        summary[result.execution_id].timedCount += 1;
        summary[result.execution_id].totalDurationMs += result.duration_ms;
      }

      if (result.created_at && (!summary[result.execution_id].latestActivityAt || result.created_at > summary[result.execution_id].latestActivityAt!)) {
        summary[result.execution_id].latestActivityAt = result.created_at;
      }
    });

    Object.values(summary).forEach((item) => {
      item.passRate = item.total ? Math.round((item.passed / item.total) * 100) : 0;
      item.avgDurationMs = item.timedCount ? Math.round(item.totalDurationMs / item.timedCount) : null;
    });

    return summary;
  }, [allExecutionResults]);

  const executionById = useMemo(
    () =>
      executions.reduce<Record<string, Execution>>((accumulator, execution) => {
        accumulator[execution.id] = execution;
        return accumulator;
      }, {}),
    [executions]
  );

  const resolvePersistedCaseDurationMs = (testCaseId: string, existing?: ExecutionResult) => {
    const startedAt =
      caseTimerStartedAtById[testCaseId] ||
      toTimestamp(existing?.created_at) ||
      toTimestamp(selectedExecution?.started_at);

    if (!startedAt) {
      return existing?.duration_ms ?? null;
    }

    const computed = Math.max(Date.now() - startedAt, 0);
    return typeof existing?.duration_ms === "number" ? Math.max(existing.duration_ms, computed) : computed;
  };

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

    if (!session?.user.id) {
      setMessageTone("error");
      setMessage("You need an active session before creating an execution.");
      return;
    }

    try {
      const response = await createExecution.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId || undefined,
        suite_ids: selectedSuiteIds,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined,
        name: executionName || undefined,
        created_by: session.user.id
      });

      closeExecutionBuilder();
      focusExecution(response.id);
      setExpandedSuiteIds([]);
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
    const durationMs = resolvePersistedCaseDurationMs(testCaseId, existing);

    if (existing) {
      await updateResult.mutateAsync({
        id: existing.id,
        input: {
          status: aggregateStatus,
          duration_ms: durationMs ?? undefined,
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
                duration_ms: durationMs,
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
      duration_ms: durationMs ?? undefined,
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
        duration_ms: durationMs,
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
          focusExecutionCase(nextCase.id);
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
  const focusExecutionCase = (testCaseId: string, executionId = selectedExecutionId) => {
    const scopedCase = executionCaseOrder.find((testCase) => testCase.id === testCaseId);

    if (scopedCase?.suite_id) {
      setExpandedSuiteIds((current) => (current.includes(scopedCase.suite_id!) ? current : [...current, scopedCase.suite_id!]));
    }

    setSelectedTestCaseId(testCaseId);

    if (executionId) {
      syncExecutionSearchParams(executionId, testCaseId);
    }
  };

  useEffect(() => {
    if (!isExecutionStarted || isExecutionLocked || !selectedTestCaseId) {
      return;
    }

    setCaseTimerStartedAtById((current) =>
      current[selectedTestCaseId] ? current : { ...current, [selectedTestCaseId]: Date.now() }
    );
  }, [isExecutionLocked, isExecutionStarted, selectedTestCaseId]);

  const resolveCaseDurationMs = (testCaseId: string, result?: ExecutionResult | null) => {
    if (typeof result?.duration_ms === "number") {
      return result.duration_ms;
    }

    const startedAt = caseTimerStartedAtById[testCaseId];
    if (startedAt && isExecutionStarted && !isExecutionLocked) {
      return Math.max(liveNow - startedAt, 0);
    }

    return null;
  };

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

  const selectedExecutionDurationMs = useMemo(
    () => computeExecutionDurationMs(selectedExecution?.started_at, selectedExecution?.ended_at, liveNow),
    [liveNow, selectedExecution?.ended_at, selectedExecution?.started_at]
  );

  const selectedCaseDurationMs = useMemo(
    () => (selectedExecutionCase ? resolveCaseDurationMs(selectedExecutionCase.id, selectedExecutionResult) : null),
    [caseTimerStartedAtById, isExecutionLocked, isExecutionStarted, liveNow, selectedExecutionCase, selectedExecutionResult]
  );

  const averageCaseDurationMs = useMemo(
    () => averageDuration(executionResults.map((result) => result.duration_ms)),
    [executionResults]
  );

  const suiteDurationById = useMemo(() => {
    return executionSuites.reduce<Record<string, number | null>>((accumulator, suite) => {
      const suiteCases = displayCasesBySuiteId[suite.id] || [];
      const total = suiteCases.reduce((sum, testCase) => {
        const duration = resolveCaseDurationMs(testCase.id, resultByCaseId[testCase.id]);
        return sum + (duration || 0);
      }, 0);
      accumulator[suite.id] = total > 0 ? total : null;
      return accumulator;
    }, {});
  }, [displayCasesBySuiteId, executionSuites, resultByCaseId, caseTimerStartedAtById, isExecutionLocked, isExecutionStarted, liveNow]);

  const executionResultsWithTiming = useMemo(
    () => executionResults.filter((result) => typeof result.duration_ms === "number").length,
    [executionResults]
  );

  const queuedCases = useMemo(
    () => executionCaseOrder.filter((testCase) => caseDerivedStatus(testCase) === "queued"),
    [executionCaseOrder, resultByCaseId]
  );

  const nextFocusCase = useMemo(
    () => blockingCases[0] || queuedCases[0] || executionCaseOrder[0] || null,
    [blockingCases, executionCaseOrder, queuedCases]
  );

  const selectedCaseHistory = useMemo(
    () =>
      selectedTestCaseId
        ? allExecutionResults
            .filter((result) => result.test_case_id === selectedTestCaseId)
            .slice()
            .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
        : [],
    [allExecutionResults, selectedTestCaseId]
  );

  const resolvedStepNoteCount = useMemo(
    () => Object.values(stepNotes).filter((value) => value.trim()).length,
    [stepNotes]
  );

  const selectedExecutionAppTypeLabel =
    appTypeNameById[selectedExecution?.app_type_id || ""] || "No app type scoped";
  const remainingCaseCount = Math.max(executionProgress.totalCases - executionProgress.completedCases, 0);
  const selectedCaseStatusLabel = selectedExecutionCase ? caseDerivedStatus(selectedExecutionCase) : executionProgress.derivedStatus;

  const filteredExecutions = useMemo(() => {
    const search = deferredExecutionSearch.trim().toLowerCase();

    if (!search) {
      return executions;
    }

    return executions.filter((execution) => {
      const projectName = projectNameById[execution.project_id] || "";
      return [execution.name || "", projectName].some((value) => value.toLowerCase().includes(search));
    });
  }, [deferredExecutionSearch, executions, projectNameById]);

  const executionCardMeasureTarget = filteredExecutions[0] || null;

  useEffect(() => {
    const node = executionCardMeasureRef.current;
    if (!node) {
      return;
    }

    const updateHeight = () => {
      const nextHeight = Math.max(180, Math.ceil(node.getBoundingClientRect().height) + 12);
      setExecutionListItemHeight((current) => (Math.abs(current - nextHeight) > 1 ? nextHeight : current));
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(node);

    return () => observer.disconnect();
  }, [executionCardMeasureTarget?.id]);

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
    const durationMs = resolvePersistedCaseDurationMs(testCaseId, existing);

    if (existing) {
      await updateResult.mutateAsync({
        id: existing.id,
        input: {
          status,
          duration_ms: durationMs ?? undefined,
          logs,
          error: status === "failed" ? "Marked at suite level" : ""
        }
      });
      queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) =>
        current.map((item) =>
          item.id === existing.id
            ? { ...item, status, duration_ms: durationMs, logs, error: status === "failed" ? "Marked at suite level" : null }
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
      duration_ms: durationMs ?? undefined,
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
        duration_ms: durationMs,
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
    <div className="page-content page-content--executions-full">
      <PageHeader
        eyebrow="Executions"
        title="Test Executions"
        description="Launch scoped runs, monitor live progress, and capture failure evidence without losing the surrounding suite and case context."
        meta={[
          { label: "Runs", value: executions.length },
          { label: "Blocking cases", value: blockingCases.length },
          { label: "Completion", value: `${executionProgress.percent}%` }
        ]}
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
          resetExecutionContextSelection();
        }}
        onProjectChange={(value) => {
          setProjectId(value);
          setAppTypeId("");
          setSelectedSuiteIds([]);
          setIsSuitePickerOpen(false);
          resetExecutionContextSelection();
        }}
        projectId={projectId}
        projects={projects}
      />

      <ExecutionAccordionPanel
        className="execution-health-panel"
        isExpanded={isExecutionHealthExpanded}
        onToggle={() => setIsExecutionHealthExpanded((current) => !current)}
        title="Execution command center"
        subtitle={selectedExecution ? "Operate the active run with live timing, failure pressure, and next-action guidance." : "Create or select an execution to inspect its health."}
      >
        {selectedExecution ? (
          <div className="execution-health-layout">
            <div className="execution-health-hero">
              <ExecutionOverviewOrb
                blockedCount={executionStatusCounts.blocked}
                failedCount={executionStatusCounts.failed}
                passedCount={executionStatusCounts.passed}
                percent={executionProgress.percent}
                totalCount={executionProgress.totalCases}
              />

              <div className="execution-health-copy">
                <div className="execution-health-status-row">
                  <StatusBadge value={currentExecutionStatus} />
                  <span className="count-pill">{selectedExecutionAppTypeLabel}</span>
                  <span className="execution-health-trigger">{(selectedExecution.trigger || "manual").toUpperCase()} trigger</span>
                </div>

                <div className="execution-health-heading">
                  <strong>{selectedExecution.name || "Unnamed execution"}</strong>
                  <span>{selectedExecutionSuiteIds.length} suites snapped into this run with {executionProgress.totalCases} cases preserved for execution evidence.</span>
                </div>

                <ProgressMeter
                  detail={`${executionStatusCounts.passed} passed · ${executionStatusCounts.failed} failed · ${executionStatusCounts.blocked} blocked · ${remainingCaseCount} remaining`}
                  label="Run completion"
                  segments={buildProgressSegments(
                    executionStatusCounts.passed,
                    executionStatusCounts.failed,
                    executionStatusCounts.blocked,
                    executionProgress.totalCases
                  )}
                  value={executionProgress.percent}
                />

                <div className="execution-health-timeline">
                  <div className="execution-timeline-item">
                    <span>Started</span>
                    <strong>{formatExecutionTimestamp(selectedExecution.started_at, currentExecutionStatus === "queued" ? "Not started yet" : "Waiting to start")}</strong>
                  </div>
                  <div className="execution-timeline-item">
                    <span>Ended</span>
                    <strong>{formatExecutionTimestamp(selectedExecution.ended_at, currentExecutionStatus === "running" ? "Live run" : currentExecutionStatus === "aborted" ? "Stopped before completion" : "Not finished yet")}</strong>
                  </div>
                  <div className="execution-timeline-item">
                    <span>Cases in scope</span>
                    <strong>{executionProgress.totalCases}</strong>
                  </div>
                </div>
              </div>

              <div className="execution-health-glance">
                <div className="execution-glance-card">
                  <span>{currentExecutionStatus === "running" ? "Elapsed run time" : "Run duration"}</span>
                  <strong>{formatDuration(selectedExecutionDurationMs, currentExecutionStatus === "queued" ? "Not started" : currentExecutionStatus === "aborted" ? "Stopped early" : "Awaiting timing")}</strong>
                  <small>{selectedExecutionDurationMs ? `${executionProgress.completedCases} cases touched so far` : currentExecutionStatus === "aborted" ? "Timing stopped when the run was aborted" : "Timing begins when the run starts"}</small>
                </div>
                <div className="execution-glance-card">
                  <span>Average case duration</span>
                  <strong>{formatDuration(averageCaseDurationMs, executionResultsWithTiming ? "Awaiting timing" : "No case timing yet")}</strong>
                  <small>{executionResultsWithTiming ? `${executionResultsWithTiming} cases already have stored duration` : "Capture evidence to unlock trend timing"}</small>
                </div>
                <div className="execution-glance-card">
                  <span>Remaining queue</span>
                  <strong>{remainingCaseCount}</strong>
                  <small>{blockingCases.length ? `${blockingCases.length} blockers need triage first` : "No blockers currently slowing the run"}</small>
                </div>
                <div className="execution-glance-card">
                  <span>Evidence records</span>
                  <strong>{executionResults.length}</strong>
                  <small>{executionResults.length ? `${executionStatusCounts.failed} failure records logged so far` : "No case evidence captured yet"}</small>
                </div>
              </div>
            </div>

            <ExecutionAccordionSection
              className="execution-health-support"
              isExpanded={isExecutionSupportExpanded}
              onToggle={() => setIsExecutionSupportExpanded((current) => !current)}
              summary="Keep the environment, configuration, and data snapshots visible while you execute."
              title="Execution context"
            >
              <ExecutionContextSnapshotSummary execution={selectedExecution} />
            </ExecutionAccordionSection>
          </div>
        ) : (
          <div className="empty-state compact">No execution selected yet. Open the create dialog to start a new run.</div>
        )}
      </ExecutionAccordionPanel>

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
              className="execution-panel execution-panel--list"
              actions={
                <button className="ghost-button execution-panel-toggle" onClick={() => setIsExecutionListMinimized(true)} type="button">
                  Minimize
                </button>
              }
              title="Runs"
              subtitle="Switch between recent executions with enough signal to know where to dive in."
            >
              <div className="execution-panel-body execution-panel-body--list">
                {executionCardMeasureTarget ? (
                  <div aria-hidden="true" className="execution-card-measure" ref={executionCardMeasureRef}>
                    <ExecutionListCard
                      appTypeName={appTypeNameById[executionCardMeasureTarget.app_type_id || ""] || "No app type scoped"}
                      execution={executionCardMeasureTarget}
                      isActive={false}
                      liveNow={liveNow}
                      onSelect={() => undefined}
                      summary={executionSummaryById[executionCardMeasureTarget.id] || EMPTY_EXECUTION_RUN_SUMMARY}
                    />
                  </div>
                ) : null}

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
                    fillHeight
                    itemHeight={executionListItemHeight}
                    itemKey={(execution) => execution.id}
                    items={filteredExecutions}
                    renderItem={(execution: Execution) => (
                      <ExecutionListCard
                        appTypeName={appTypeNameById[execution.app_type_id || ""] || "No app type scoped"}
                        execution={execution}
                        isActive={selectedExecution?.id === execution.id}
                        liveNow={liveNow}
                        onSelect={() => focusExecution(execution.id)}
                        summary={executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY}
                      />
                    )}
                  />
                ) : null}
              </div>
            </Panel>
          )}
        </div>

        <div className={isSuiteTreeMinimized ? "execution-column execution-column--collapsed" : "execution-column"}>
          {isSuiteTreeMinimized ? (
            <ExecutionMinimizedRail
              count={selectedExecutionSuiteIds.length}
              label="Run board"
              onExpand={() => setIsSuiteTreeMinimized(false)}
            />
          ) : (
            <Panel
              className="execution-panel execution-panel--tree"
              actions={
                <button className="ghost-button execution-panel-toggle" onClick={() => setIsSuiteTreeMinimized(true)} type="button">
                  Minimize
                </button>
              }
              title="Execution board"
              subtitle={selectedExecution ? "Run through the snapped suite queue with stronger progress, timing, and next-case signal." : "Select an execution to see its snapped scope."}
            >
              {selectedExecution ? (
                <div className="execution-panel-body execution-panel-body--tree">
                  <div className="suite-tree">
                    <div className="execution-board-hero">
                      <div className="execution-board-primary">
                        <div className="execution-section-head">
                          <strong>Run board overview</strong>
                          <span>Use this lane to move through suites, understand progress, and keep the next case obvious.</span>
                        </div>
                        <ProgressMeter
                          detail={`${executionStatusCounts.passed} passed · ${executionStatusCounts.failed} failed · ${executionStatusCounts.blocked} blocked · ${remainingCaseCount} remaining`}
                          label="Execution progress"
                          segments={buildProgressSegments(
                            executionStatusCounts.passed,
                            executionStatusCounts.failed,
                            executionStatusCounts.blocked,
                            executionProgress.totalCases
                          )}
                          value={executionProgress.percent}
                        />
                        <div className="execution-board-kpis">
                          <div className="execution-board-kpi">
                            <span>Completed</span>
                            <strong>{executionProgress.completedCases}/{executionProgress.totalCases}</strong>
                          </div>
                          <div className="execution-board-kpi">
                            <span>Scoped suites</span>
                            <strong>{selectedExecutionSuiteIds.length}</strong>
                          </div>
                          <div className="execution-board-kpi">
                            <span>Elapsed</span>
                            <strong>{formatDuration(selectedExecutionDurationMs, currentExecutionStatus === "queued" ? "Not started" : currentExecutionStatus === "aborted" ? "Stopped early" : "Awaiting timing")}</strong>
                          </div>
                        </div>
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
                                  <span className="tile-metric">{formatDuration(suiteDurationById[suite.id], "No timing yet")}</span>
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
                                  className={
                                    selectedTestCaseId === testCase.id
                                      ? "record-card tile-card test-case-card execution-case-card is-active"
                                      : nextFocusCase?.id === testCase.id
                                        ? "record-card tile-card test-case-card execution-case-card is-next"
                                        : "record-card tile-card test-case-card execution-case-card"
                                  }
                                  onClick={() => focusExecutionCase(testCase.id)}
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
                                      <span className="tile-metric">{(stepsByCaseId[testCase.id] || []).length} steps</span>
                                      <span className="tile-metric">{formatDuration(resolveCaseDurationMs(testCase.id, resultByCaseId[testCase.id]), "No timing yet")}</span>
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
                </div>
              ) : (
                <div className="execution-panel-body execution-panel-body--tree">
                  <div className="empty-state compact">Select an execution to inspect its snapshot scope.</div>
                </div>
              )}
            </Panel>
          )}
        </div>

        <div className="execution-column execution-column--detail">
          <Panel
            className="execution-panel execution-panel--detail"
            title="Execution console"
            subtitle={selectedExecutionCase ? "Run the selected case, capture evidence, and inspect history without leaving the console." : "Select a case to view step execution and logs."}
          >
            {selectedExecution ? (
              <div className="execution-panel-body execution-panel-body--detail">
                <div className="detail-stack">
                  <div className="execution-detail-hero">
                    <div className="execution-detail-heading">
                      <div className="execution-health-status-row">
                        <StatusBadge value={selectedCaseStatusLabel} />
                        {selectedExecutionCase?.suite_name ? <span className="count-pill">{selectedExecutionCase.suite_name}</span> : null}
                        <span className="execution-health-trigger">{selectedExecutionCase ? "Selected case" : "Run overview"}</span>
                      </div>
                      <strong>{selectedExecutionCase?.title || selectedExecution.name || "Unnamed execution"}</strong>
                      <span>{selectedExecutionCase?.description || "Select a case from the run board to execute its steps and capture evidence."}</span>
                    </div>

                    <div className="execution-detail-glance">
                      <div className="execution-detail-card">
                        <span>Case duration</span>
                        <strong>{formatDuration(selectedCaseDurationMs, selectedExecutionCase ? "No timing yet" : "Select a case")}</strong>
                        <small>{selectedExecutionResult?.created_at ? `Last evidence ${formatExecutionTimestamp(selectedExecutionResult.created_at)}` : "Duration appears as the case is executed"}</small>
                      </div>
                      <div className="execution-detail-card">
                        <span>Step completion</span>
                        <strong>{selectedSteps.length ? `${selectedStepProgress.percent}%` : "0%"}</strong>
                        <small>{selectedSteps.length ? `${selectedStepProgress.passedCount + selectedStepProgress.failedCount}/${selectedSteps.length} steps resolved` : "No steps loaded for this case"}</small>
                      </div>
                      <div className="execution-detail-card">
                        <span>Evidence notes</span>
                        <strong>{resolvedStepNoteCount}</strong>
                        <small>{resolvedStepNoteCount ? "Comments captured for this case" : "No comments captured yet"}</small>
                      </div>
                    </div>
                  </div>

                  <div className="execution-control-strip">
                    <div className="execution-control-copy">
                      <strong>{currentExecutionStatus === "running" ? "Execution is live" : currentExecutionStatus === "queued" ? "Execution ready to start" : currentExecutionStatus === "aborted" ? "Execution was aborted" : "Execution locked"}</strong>
                      <span>{currentExecutionStatus === "running" ? `${formatDuration(selectedExecutionDurationMs, "Live")} elapsed across the run.` : currentExecutionStatus === "queued" ? "Start the run before step-level result capture." : currentExecutionStatus === "aborted" ? "This execution was stopped early. Captured evidence remains available for review." : "This execution has been completed. Evidence remains available for review."}</span>
                    </div>
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
                  </div>

                  <SubnavTabs
                    items={[
                      { value: "overview", label: "Overview", meta: `${selectedSteps.length} steps` },
                      { value: "logs", label: "Logs", meta: selectedExecutionResult?.status || "none" },
                      { value: "failures", label: "Failures", meta: `${blockingCases.length}` },
                      { value: "history", label: "History", meta: `${selectedCaseHistory.length}` }
                    ]}
                    onChange={setActiveTab}
                    value={activeTab}
                  />

                  {activeTab === "overview" ? (
                    <div className="detail-stack">
                      {selectedExecutionCase ? (
                        <div className="execution-step-progress-card">
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

                      {!selectedExecutionCase ? <div className="empty-state compact">Select a case from the execution board to run its steps.</div> : null}
                      {selectedExecutionCase && !selectedSteps.length ? <div className="empty-state compact">No snapshot steps are available for this case.</div> : null}

                      {selectedSteps.length ? (
                        <div className="execution-steps-toolbar">
                          <div className="execution-steps-bulk-buttons">
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
                      {isExecutionLocked ? <div className="empty-state compact">This execution is locked because it is {executionStatusLabel(currentExecutionStatus).toLowerCase()}.</div> : null}
                    </div>
                  ) : null}

                  {activeTab === "logs" ? (
                    <div className="stack-list execution-logs-stack">
                      {selectedExecutionResult ? (
                        <div className="execution-log-focus">
                          <div className="execution-section-head">
                            <strong>{selectedExecutionResult.test_case_title || selectedExecutionCase?.title || "Selected case logs"}</strong>
                            <span>{selectedExecutionResult.error || "Structured evidence and notes for the focused case."}</span>
                          </div>
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
                              <span>{formatExecutionTimestamp(result.created_at, "Timestamp unavailable")} · {formatDuration(result.duration_ms, "No duration yet")}</span>
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
                        <button className="stack-item stack-item-button" key={testCase.id} onClick={() => focusExecutionCase(testCase.id)} type="button">
                          <div>
                            <strong>{testCase.title}</strong>
                            <span>{testCase.description || "Blocked or failed case."}</span>
                            <small>{formatDuration(resolveCaseDurationMs(testCase.id, resultByCaseId[testCase.id]), "No timing yet")}</small>
                          </div>
                          <StatusBadge value={caseDerivedStatus(testCase)} />
                        </button>
                      ))}
                      {!blockingCases.length ? <div className="empty-state compact">No failed or blocked cases in this execution.</div> : null}
                    </div>
                  ) : null}

                  {activeTab === "history" ? (
                    <div className="stack-list execution-history-stack">
                      {selectedCaseHistory.map((result) => {
                        const linkedExecution = executionById[result.execution_id];
                        const isCurrentExecution = result.execution_id === selectedExecution.id;

                        return (
                          <button
                            className={isCurrentExecution ? "stack-item stack-item-button execution-history-row is-current" : "stack-item stack-item-button execution-history-row"}
                            key={result.id}
                            onClick={() => focusExecutionCase(result.test_case_id, result.execution_id)}
                            type="button"
                          >
                            <div>
                              <strong>{linkedExecution?.name || result.test_case_title || "Execution record"}</strong>
                              <span>{result.suite_name || "Recorded case evidence"} · {formatExecutionTimestamp(result.created_at, "Timestamp unavailable")}</span>
                              <small>{formatDuration(result.duration_ms, "No duration yet")} · {isCurrentExecution ? "Current run" : "Open this execution"}</small>
                            </div>
                            <StatusBadge value={result.status} />
                          </button>
                        );
                      })}
                      {!selectedExecutionCase ? <div className="empty-state compact">Select a case to inspect its execution history across runs.</div> : null}
                      {selectedExecutionCase && !selectedCaseHistory.length ? <div className="empty-state compact">No execution history exists yet for this selected case.</div> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="execution-panel-body execution-panel-body--detail">
                <div className="empty-state compact">Select an execution to continue.</div>
              </div>
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
          onConfigurationChange={setSelectedExecutionConfigurationId}
          onDataSetChange={setSelectedExecutionDataSetId}
          onEnvironmentChange={setSelectedExecutionEnvironmentId}
          onAppTypeChange={(value) => {
            setAppTypeId(value);
            setSelectedSuiteIds([]);
            setIsSuitePickerOpen(false);
            resetExecutionContextSelection();
          }}
          onClose={closeExecutionBuilder}
          onExecutionNameChange={setExecutionName}
          onProjectChange={(value) => {
            setProjectId(value);
            setAppTypeId("");
            setSelectedSuiteIds([]);
            setIsSuitePickerOpen(false);
            resetExecutionContextSelection();
          }}
          onRemoveSuite={(suiteId) => setSelectedSuiteIds((current) => current.filter((id) => id !== suiteId))}
          onSelectSuites={() => setIsSuitePickerOpen(true)}
          onSubmit={(event) => void handleCreateExecution(event)}
          projectId={projectId}
          projects={projects}
          selectedConfigurationId={selectedExecutionConfigurationId}
          scopeSuites={scopeSuites}
          selectedAppType={selectedAppType?.name || ""}
          selectedDataSetId={selectedExecutionDataSetId}
          selectedEnvironmentId={selectedExecutionEnvironmentId}
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

function ExecutionAccordionPanel({
  title,
  subtitle,
  isExpanded,
  onToggle,
  className = "",
  children
}: {
  title: string;
  subtitle?: string;
  isExpanded: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel card execution-accordion-panel ${className}`.trim()}>
      <button
        aria-expanded={isExpanded}
        className="execution-accordion-toggle execution-accordion-toggle--panel"
        onClick={onToggle}
        type="button"
      >
        <div className="execution-accordion-toggle-main">
          <span aria-hidden="true" className={isExpanded ? "execution-accordion-icon is-expanded" : "execution-accordion-icon"}>
            <ExecutionAccordionChevronIcon />
          </span>
          <div className="execution-accordion-toggle-copy">
            <strong>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
        </div>
        <div className="execution-accordion-toggle-meta">
          <span className="execution-accordion-toggle-state">{isExpanded ? "Collapse" : "Expand"}</span>
        </div>
      </button>
      {isExpanded ? <div className="execution-accordion-panel-body">{children}</div> : null}
    </section>
  );
}

function ExecutionAccordionSection({
  title,
  summary,
  isExpanded,
  onToggle,
  className = "",
  children
}: {
  title: string;
  summary: string;
  isExpanded: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`${isExpanded ? "execution-accordion-section is-expanded" : "execution-accordion-section"} ${className}`.trim()}>
      <button
        aria-expanded={isExpanded}
        className="execution-accordion-toggle execution-accordion-toggle--section"
        onClick={onToggle}
        type="button"
      >
        <div className="execution-accordion-toggle-main">
          <span aria-hidden="true" className={isExpanded ? "execution-accordion-icon is-expanded" : "execution-accordion-icon"}>
            <ExecutionAccordionChevronIcon />
          </span>
          <div className="execution-accordion-toggle-copy">
            <strong>{title}</strong>
            <span>{summary}</span>
          </div>
        </div>
        <div className="execution-accordion-toggle-meta">
          <span className="execution-accordion-toggle-state">{isExpanded ? "Collapse" : "Expand"}</span>
        </div>
      </button>
      {isExpanded ? <div className="execution-accordion-body">{children}</div> : null}
    </section>
  );
}

function ExecutionAccordionChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function ExecutionListCard({
  execution,
  summary,
  appTypeName,
  liveNow,
  isActive,
  onSelect
}: {
  execution: Execution;
  summary: ExecutionRunSummary;
  appTypeName: string;
  liveNow: number;
  isActive: boolean;
  onSelect: () => void;
}) {
  const totalScopedCases = execution.case_snapshots?.length || summary.total || 0;
  const resolvedTotal = Math.max(totalScopedCases, summary.total, 0);
  const executionStatus = normalizeExecutionStatus(execution.status);
  const issueCount = summary.failed + summary.blocked;
  const durationLabel = formatDuration(
    computeExecutionDurationMs(execution.started_at, execution.ended_at, liveNow),
    executionStatus === "queued" ? "Queued" : executionStatus === "aborted" ? "Stopped early" : "No timing"
  );
  const startedLabel = formatExecutionTimestamp(
    execution.started_at,
    executionStatus === "queued" ? "Not started yet" : "Waiting to start"
  );
  const latestEvidenceLabel = summary.latestActivityAt
    ? formatExecutionTimestamp(summary.latestActivityAt)
    : "No evidence yet";
  const progressDetail = resolvedTotal
    ? `${summary.total}/${resolvedTotal} touched · ${summary.failed} failed · ${summary.blocked} blocked`
    : "No evidence recorded yet";
  const completionPercent = resolvedTotal ? Math.round((summary.total / resolvedTotal) * 100) : 0;

  return (
    <button
      className={isActive ? "record-card tile-card execution-card virtual-card is-active" : "record-card tile-card execution-card virtual-card"}
      onClick={onSelect}
      type="button"
    >
      <div className="tile-card-main">
        <div className="tile-card-header">
          <div
            aria-hidden="true"
            className={`record-card-icon execution status-${executionStatus}`}
            title={executionStatusTooltip(executionStatus)}
          >
            <ExecutionRunIcon />
          </div>
          <div className="tile-card-title-group">
            <strong>{execution.name || "Unnamed execution"}</strong>
            <span className="tile-card-kicker">{appTypeName}</span>
          </div>
          <ExecutionStatusIndicator status={executionStatus} />
        </div>

        <div className="execution-card-facts" aria-label="Execution facts">
          <ExecutionCardFact
            ariaLabel={`${execution.suite_ids.length} suites in scope`}
            label={String(execution.suite_ids.length)}
            title={`${execution.suite_ids.length} suites in scope`}
          >
            <ExecutionSuiteIcon />
          </ExecutionCardFact>
          <ExecutionCardFact
            ariaLabel={resolvedTotal ? `${summary.total} of ${resolvedTotal} cases touched` : `${summary.total} cases touched`}
            label={resolvedTotal ? `${summary.total}/${resolvedTotal}` : `${summary.total}`}
            title={resolvedTotal ? `${summary.total}/${resolvedTotal} cases touched` : `${summary.total} cases touched`}
          >
            <ExecutionScopeIcon />
          </ExecutionCardFact>
          <ExecutionCardFact
            ariaLabel={issueCount ? `${issueCount} failed or blocked cases` : executionStatus === "aborted" ? "Run aborted before failures were recorded" : "No failed or blocked cases"}
            label={String(issueCount)}
            title={issueCount ? `${issueCount} failed or blocked cases` : executionStatus === "aborted" ? "Run aborted before failures were recorded" : "No failed or blocked cases"}
            tone={issueCount ? "danger" : executionStatus === "aborted" ? "warning" : "success"}
          >
            <ExecutionRiskIcon />
          </ExecutionCardFact>
          <ExecutionCardFact
            ariaLabel={`Run duration ${durationLabel}`}
            label={durationLabel}
            title={`Started: ${startedLabel}${summary.latestActivityAt ? ` • Latest evidence: ${latestEvidenceLabel}` : executionStatus === "aborted" ? " • Run stopped before completion" : ""}`}
            tone={executionStatus === "aborted" ? "warning" : "neutral"}
          >
            <ExecutionTimeIcon />
          </ExecutionCardFact>
        </div>

        <ProgressMeter
          detail={progressDetail}
          hideCopy
          label="Run completion"
          segments={buildProgressSegments(
            summary.passed,
            summary.failed,
            summary.blocked,
            resolvedTotal || summary.total
          )}
          value={completionPercent}
        />
      </div>
    </button>
  );
}

function ExecutionCardFact({
  title,
  ariaLabel,
  label,
  tone = "neutral",
  children
}: {
  title: string;
  ariaLabel: string;
  label?: string;
  tone?: "neutral" | "info" | "success" | "danger" | "warning";
  children: ReactNode;
}) {
  return (
    <span
      aria-label={ariaLabel}
      className={`execution-card-fact tone-${tone}`}
      title={title}
    >
      <span aria-hidden="true" className="execution-card-fact-icon">
        {children}
      </span>
      {label ? <span className="execution-card-fact-label">{label}</span> : null}
    </span>
  );
}

function ExecutionStatusIndicator({ status }: { status: ExecutionStatus }) {
  const tooltip = executionStatusTooltip(status);

  return (
    <span aria-label={tooltip} className={`execution-card-status status-${status}`} title={tooltip}>
      <ExecutionStatusIcon status={status} />
    </span>
  );
}

function ExecutionStatusIcon({ status }: { status: ExecutionStatus }) {
  if (status === "queued") {
    return (
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </svg>
    );
  }

  if (status === "running") {
    return (
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
        <path d="M5 12a7 7 0 0 1 7-7" />
        <path d="M19 12a7 7 0 0 1-7 7" />
        <path d="m13 8 4 0 0-4" />
        <path d="m11 16-4 0 0 4" />
      </svg>
    );
  }

  if (status === "completed") {
    return (
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
        <path d="M6 12.5 10 16l8-8" />
      </svg>
    );
  }

  if (status === "failed") {
    return (
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
        <path d="m12 4 8 14H4z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      <circle cx="12" cy="12" r="8" />
      <path d="M9 9l6 6" />
      <path d="M15 9l-6 6" />
    </svg>
  );
}

function ExecutionRunIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="20">
      <path d="m9 7 8 5-8 5z" />
    </svg>
  );
}

function ExecutionIconShell({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">{children}</svg>;
}

function ExecutionSuiteIcon() {
  return (
    <ExecutionIconShell>
      <rect height="6" rx="1.2" width="7" x="3" y="4" />
      <rect height="6" rx="1.2" width="7" x="14" y="4" />
      <rect height="6" rx="1.2" width="7" x="8.5" y="14" />
    </ExecutionIconShell>
  );
}

function ExecutionScopeIcon() {
  return (
    <ExecutionIconShell>
      <rect height="14" rx="2" width="14" x="5" y="5" />
      <path d="M9 10h6" />
      <path d="M9 14h6" />
    </ExecutionIconShell>
  );
}

function ExecutionRiskIcon() {
  return (
    <ExecutionIconShell>
      <path d="m12 4 8 14H4z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </ExecutionIconShell>
  );
}

function ExecutionTimeIcon() {
  return (
    <ExecutionIconShell>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </ExecutionIconShell>
  );
}

function ExecutionOverviewOrb({
  passedCount,
  failedCount,
  blockedCount,
  totalCount,
  percent
}: {
  passedCount: number;
  failedCount: number;
  blockedCount: number;
  totalCount: number;
  percent: number;
}) {
  const safeTotal = Math.max(totalCount, 1);
  const pendingCount = Math.max(totalCount - passedCount - failedCount - blockedCount, 0);
  const passedStop = (passedCount / safeTotal) * 100;
  const failedStop = passedStop + (failedCount / safeTotal) * 100;
  const blockedStop = failedStop + (blockedCount / safeTotal) * 100;
  const orbBackground = `conic-gradient(
    #1aa96b 0% ${passedStop}%,
    #d04668 ${passedStop}% ${failedStop}%,
    #2d66e6 ${failedStop}% ${blockedStop}%,
    rgba(94, 116, 146, 0.16) ${blockedStop}% 100%
  )`;

  return (
    <div className="execution-overview-orb-shell">
      <div className="execution-overview-orb" style={{ background: orbBackground }}>
        <div className="execution-overview-orb-core">
          <strong>{percent}%</strong>
          <span>Run complete</span>
        </div>
      </div>
      <div className="execution-overview-legend">
        <span className="execution-legend-item tone-passed">{passedCount} passed</span>
        <span className="execution-legend-item tone-failed">{failedCount} failed</span>
        <span className="execution-legend-item tone-blocked">{blockedCount} blocked</span>
        <span className="execution-legend-item tone-pending">{pendingCount} queued</span>
      </div>
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
  selectedEnvironmentId,
  selectedConfigurationId,
  selectedDataSetId,
  onExecutionNameChange,
  onEnvironmentChange,
  onConfigurationChange,
  onDataSetChange,
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
  selectedEnvironmentId: string;
  selectedConfigurationId: string;
  selectedDataSetId: string;
  onExecutionNameChange: (value: string) => void;
  onEnvironmentChange: (value: string) => void;
  onConfigurationChange: (value: string) => void;
  onDataSetChange: (value: string) => void;
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
                <ProjectDropdown
                  ariaLabel="Select a project"
                  onChange={onProjectChange}
                  projects={projects}
                  value={projectId}
                />
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

            <ExecutionContextSelector
              appTypeId={appTypeId}
              onConfigurationChange={onConfigurationChange}
              onDataSetChange={onDataSetChange}
              onEnvironmentChange={onEnvironmentChange}
              prefillFirstAvailable={true}
              projectId={projectId}
              selectedConfigurationId={selectedConfigurationId}
              selectedDataSetId={selectedDataSetId}
              selectedEnvironmentId={selectedEnvironmentId}
            />

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

function ExecutionContextSnapshotSummary({ execution }: { execution: Execution }) {
  const environmentSummary = execution.test_environment?.snapshot;
  const configurationSummary = execution.test_configuration?.snapshot;
  const dataSetSummary = execution.test_data_set?.snapshot;
  const configurationTarget = [
    configurationSummary?.browser,
    configurationSummary?.mobile_os,
    configurationSummary?.platform_version
  ].filter(Boolean).join(" · ");

  return (
    <div className="execution-context-cards">
      <div className="execution-context-card">
        <span>Environment</span>
        <strong>{execution.test_environment?.name || "No environment attached"}</strong>
        <small>{environmentSummary?.base_url || environmentSummary?.browser || "No environment snapshot details recorded."}</small>
      </div>
      <div className="execution-context-card">
        <span>Configuration</span>
        <strong>{execution.test_configuration?.name || "No configuration attached"}</strong>
        <small>{configurationTarget || (configurationSummary?.variables?.length ? `${configurationSummary.variables.length} variables available` : "No configuration snapshot details recorded.")}</small>
      </div>
      <div className="execution-context-card">
        <span>Data set</span>
        <strong>{execution.test_data_set?.name || "No data set attached"}</strong>
        <small>
          {dataSetSummary
            ? dataSetSummary.mode === "table"
              ? `${dataSetSummary.rows.length} table rows snapped`
              : `${dataSetSummary.rows.length} key/value pairs snapped`
            : "No data snapshot details recorded."}
        </small>
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
