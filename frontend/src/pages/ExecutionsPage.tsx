import { FormEvent, Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ActivityIcon, ArchiveIcon, CalendarIcon, GithubIcon, GoogleDriveIcon, ImportIcon, OpenIcon, PlayIcon, SparkIcon, TrashIcon, UsersIcon } from "../components/AppIcons";
import { CatalogActionMenu } from "../components/CatalogActionMenu";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { FormField } from "../components/FormField";
import { ExecutionContextSelector } from "../components/ExecutionContextSelector";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import {
  AutomationCodeIcon,
  CodePreviewDialog,
  SharedGroupLevelIcon,
  StandardStepIcon,
  StepIconButton as InlineStepToolButton,
  StepTypeIcon
} from "../components/StepAutomationEditor";
import { ProjectDropdown } from "../components/ProjectDropdown";
import { ProgressMeter } from "../components/ProgressMeter";
import { StepParameterizedText } from "../components/StepParameterizedText";
import { StatusBadge } from "../components/StatusBadge";
import { SubnavTabs } from "../components/SubnavTabs";
import { SuiteScopePicker } from "../components/SuiteCasePicker";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { ToastMessage } from "../components/ToastMessage";
import { VirtualList } from "../components/VirtualList";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import { buildCaseAutomationCode, buildGroupAutomationCode, resolveStepAutomationCode } from "../lib/stepAutomation";
import {
  deriveCaseStatusFromSteps,
  parseExecutionLogs,
  stringifyExecutionLogs,
  type ExecutionStepEvidence,
  type ExecutionStepStatus
} from "../lib/executionLogs";
import { buildDataSetParameterValues, resolveStepParameterText } from "../lib/stepParameters";
import { type AssigneeOption, buildAssigneeOptions, resolveUserInitials, resolveUserPrimaryLabel, resolveUserSecondaryLabel } from "../lib/userDisplay";
import type {
  AppType,
  Execution,
  ExecutionCaseSnapshot,
  ExecutionDataSetSnapshot,
  ExecutionResult,
  ExecutionSchedule,
  ExecutionStatus,
  ExecutionStepSnapshot,
  Integration,
  KeyValueEntry,
  Project,
  SmartExecutionImpactCase,
  SmartExecutionPreviewResponse,
  TestStep,
  TestSuite,
  WorkspaceTransaction
} from "../types";

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
  parameter_values: Record<string, string>;
  suite_id: string | null;
  suite_name: string | null;
  suite_ids: string[];
  sort_order: number;
  assigned_to: string | null;
  assigned_user: Execution["assigned_user"];
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

type ExecutionStepBlock = {
  key: string;
  groupId: string | null;
  groupName: string | null;
  groupKind: TestStep["group_kind"];
  steps: TestStep[];
};

type ExecutionIssueFilter = "all" | "with-issues" | "clean";
type ExecutionEvidenceFilter = "all" | "with-evidence" | "no-evidence";
type ExecutionCreateMode = "manual" | "smart";
type TestRunsView = "executions" | "scheduled" | "operations";

type ExecutionAssigneeOption = AssigneeOption;

type ExecutionEvidencePreviewState = {
  stepLabel: string;
  fileName: string | null;
  dataUrl: string;
};

type SmartExecutionRequirementOption = {
  id: string;
  title: string;
  description: string | null;
  linkedCaseCount: number;
};

type ExecutionScheduleCadence = "once" | "daily" | "weekly" | "monthly";

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

const DEFAULT_DURATION_LABEL = "0s";
const MAX_EXECUTION_EVIDENCE_IMAGE_BYTES = 3 * 1024 * 1024;

type BoardStatusTone = ExecutionStatus | ExecutionResult["status"];

const BOARD_STATUS_META: Record<BoardStatusTone, { label: string; description: string }> = {
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
  },
  passed: {
    label: "Passed",
    description: "Case finished successfully."
  },
  blocked: {
    label: "Blocked",
    description: "Case is blocked and needs attention."
  }
};

function normalizeExecutionStatus(status: Execution["status"] | null | undefined): ExecutionStatus {
  if (status === "running" || status === "completed" || status === "failed" || status === "aborted") {
    return status;
  }

  return "queued";
}

function executionStatusLabel(status: Execution["status"] | null | undefined) {
  return BOARD_STATUS_META[normalizeExecutionStatus(status)].label;
}

function executionStatusTooltip(status: Execution["status"] | null | undefined) {
  const { label, description } = BOARD_STATUS_META[normalizeExecutionStatus(status)];
  return `${label}: ${description}`;
}

function boardStatusTooltip(status: BoardStatusTone) {
  const { label, description } = BOARD_STATUS_META[status];
  return `${label}: ${description}`;
}

function suiteBoardStatus(metric: {
  count: number;
  passedCount: number;
  failedCount: number;
  blockedCount: number;
}): BoardStatusTone {
  if (metric.failedCount) {
    return "failed";
  }

  if (metric.blockedCount) {
    return "blocked";
  }

  if (!metric.count) {
    return "queued";
  }

  if (metric.passedCount >= metric.count) {
    return "completed";
  }

  if (metric.passedCount > 0) {
    return "running";
  }

  return "queued";
}

function toCaseView(snapshot: ExecutionCaseSnapshot): ExecutionCaseView {
  return {
    id: snapshot.test_case_id,
    title: snapshot.test_case_title,
    description: snapshot.test_case_description,
    priority: snapshot.priority,
    status: snapshot.status,
    parameter_values: snapshot.parameter_values || {},
    suite_id: snapshot.suite_id,
    suite_name: snapshot.suite_name,
    suite_ids: snapshot.suite_id ? [snapshot.suite_id] : [],
    sort_order: snapshot.sort_order,
    assigned_to: snapshot.assigned_to || null,
    assigned_user: snapshot.assigned_user || null
  };
}

function toStepView(snapshot: ExecutionStepSnapshot): TestStep {
  return {
    id: snapshot.snapshot_step_id,
    test_case_id: snapshot.test_case_id,
    step_order: snapshot.step_order,
    action: snapshot.action,
    expected_result: snapshot.expected_result,
    step_type: snapshot.step_type,
    automation_code: snapshot.automation_code,
    api_request: snapshot.api_request,
    group_id: snapshot.group_id,
    group_name: snapshot.group_name,
    group_kind: snapshot.group_kind,
    reusable_group_id: snapshot.reusable_group_id
  };
}

function isStepGroupStart(steps: TestStep[], index: number) {
  const currentStep = steps[index];
  const previousStep = steps[index - 1];

  return Boolean(currentStep?.group_id) && currentStep.group_id !== previousStep?.group_id;
}

function getExecutionStepKindMeta(kind?: TestStep["group_kind"] | null) {
  if (kind === "reusable") {
    return { label: "Shared Steps", detail: "Shared group snapshot", tone: "shared" as const };
  }

  if (kind === "local") {
    return { label: "Local group", detail: "Local group snapshot", tone: "local" as const };
  }

  return { label: "Standard step", detail: "Standard step", tone: "default" as const };
}

const mergeExecutionEvidencePatch = (
  current: Record<string, ExecutionStepEvidence>,
  patch?: Record<string, ExecutionStepEvidence | null>
) => {
  if (!patch) {
    return current;
  }

  const next = { ...current };

  Object.entries(patch).forEach(([stepId, evidence]) => {
    if (!evidence?.dataUrl) {
      delete next[stepId];
      return;
    }

    next[stepId] = evidence;
  });

  return next;
};

const readExecutionEvidenceImage = (file: File) =>
  new Promise<ExecutionStepEvidence>((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Upload a PNG, JPG, WebP, GIF, or another supported image file."));
      return;
    }

    if (file.size > MAX_EXECUTION_EVIDENCE_IMAGE_BYTES) {
      reject(new Error("Evidence images must be 3 MB or smaller because they are stored directly in the execution record."));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = String(reader.result || "");

      if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
        reject(new Error("Unable to encode the selected image for execution evidence."));
        return;
      }

      resolve({
        dataUrl,
        fileName: file.name || undefined,
        mimeType: file.type || undefined
      });
    };
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
    reader.readAsDataURL(file);
  });

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

function formatDuration(ms?: number | null, fallback = DEFAULT_DURATION_LABEL) {
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

function readWorkspaceTransactionCount(transaction: WorkspaceTransaction, key: string) {
  const value = transaction.metadata?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function describeWorkspaceTransaction(
  transaction: WorkspaceTransaction,
  {
    appTypeNameById,
    projectNameById
  }: {
    appTypeNameById: Record<string, string>;
    projectNameById: Record<string, string>;
  }
) {
  const importSource = String(transaction.metadata?.import_source || "").toLowerCase();
  const requirementCount = readWorkspaceTransactionCount(transaction, "requirement_count");
  const generatedCaseCount = readWorkspaceTransactionCount(transaction, "generated_cases_count");
  const importedCount = readWorkspaceTransactionCount(transaction, "imported");
  const failedCount = readWorkspaceTransactionCount(transaction, "failed");
  const totalRows = readWorkspaceTransactionCount(transaction, "total_rows");
  const scopeLabel = transaction.app_type_id
    ? appTypeNameById[transaction.app_type_id] || "App type scope"
    : transaction.project_id
      ? projectNameById[transaction.project_id] || "Project scope"
      : "Workspace scope";

  if (transaction.action === "scheduled_test_case_generation" || transaction.category === "ai_generation") {
    const readyForReviewDetail = generatedCaseCount
      ? `${formatCountLabel(generatedCaseCount, "scheduler-generated test case")} ready for review.`
      : "No scheduler-generated test cases are ready for review yet.";

    return {
      icon: <SparkIcon />,
      eyebrow:
        transaction.status === "completed"
          ? "Latest AI generation job completed"
          : transaction.status === "failed"
            ? "AI generation finished with issues"
            : "Scheduled AI generation",
      detail:
        transaction.status === "completed"
          ? readyForReviewDetail
          : generatedCaseCount || requirementCount
            ? `${formatCountLabel(requirementCount, "requirement")} queued or processed · ${formatCountLabel(generatedCaseCount, "case")} generated`
            : "AI-assisted test case generation workflow"
    };
  }

  if (transaction.action === "test_case_import") {
    return {
      icon: <ImportIcon />,
      eyebrow: importSource === "junit_xml" ? "JUnit XML import" : "Test case CSV import",
      detail:
        importedCount || failedCount || totalRows
          ? `${formatCountLabel(importedCount, "case")} imported · ${formatCountLabel(failedCount, "row")} failed`
          : "Bulk test case import"
    };
  }

  if (transaction.action === "requirement_import") {
    return {
      icon: <ImportIcon />,
      eyebrow: "Requirement import",
      detail:
        importedCount || failedCount || totalRows
          ? `${formatCountLabel(importedCount, "requirement")} imported · ${formatCountLabel(failedCount, "row")} failed`
          : "Bulk requirement import"
    };
  }

  if (transaction.action === "user_import") {
    return {
      icon: <UsersIcon />,
      eyebrow: "User import",
      detail:
        importedCount || failedCount || totalRows
          ? `${formatCountLabel(importedCount, "user")} imported · ${formatCountLabel(failedCount, "row")} failed`
          : "Bulk user import"
    };
  }

  if (transaction.category === "backup" || transaction.action === "project_artifact_backup" || transaction.action === "project_code_sync") {
    const provider = String(transaction.metadata?.provider || "").toLowerCase();
    const repository = String(transaction.metadata?.repository || "");
    const fileName = String(transaction.metadata?.file_name || "");

    if (provider === "google_drive" || transaction.action === "project_artifact_backup") {
      return {
        icon: <GoogleDriveIcon />,
        eyebrow: "Google Drive backup",
        detail: fileName ? `Uploaded ${fileName}` : "Compressed project artifact backup"
      };
    }

    if (provider === "github" || transaction.action === "project_code_sync") {
      return {
        icon: <GithubIcon />,
        eyebrow: "GitHub sync",
        detail: repository ? `Automation code synced to ${repository}` : "Project automation code sync"
      };
    }

    return {
      icon: <ArchiveIcon />,
      eyebrow: "Project backup",
      detail: transaction.description || "Project backup activity"
    };
  }

  return {
    icon: transaction.category === "bulk_import" ? <ImportIcon /> : <SparkIcon />,
    eyebrow: transaction.title,
    detail: transaction.description || scopeLabel
  };
}

function resolveWorkspaceTransactionSummary(
  transaction: WorkspaceTransaction,
  presentation: ReturnType<typeof describeWorkspaceTransaction>
) {
  if (transaction.action === "scheduled_test_case_generation" || transaction.category === "ai_generation") {
    return presentation.detail;
  }

  return transaction.description || presentation.detail;
}

function executionImpactLevelLabel(level: SmartExecutionImpactCase["impact_level"]) {
  return level.charAt(0).toUpperCase() + level.slice(1);
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
  const [executionCreateMode, setExecutionCreateMode] = useState<ExecutionCreateMode>("manual");
  const [testRunsView, setTestRunsView] = useState<TestRunsView>("executions");
  const [selectedSuiteIds, setSelectedSuiteIds] = useState<string[]>([]);
  const [isCreateExecutionModalOpen, setIsCreateExecutionModalOpen] = useState(false);
  const [isCreateScheduleModalOpen, setIsCreateScheduleModalOpen] = useState(false);
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [selectedOperationId, setSelectedOperationId] = useState("");
  const [focusedSuiteId, setFocusedSuiteId] = useState("");
  const [expandedExecutionSuiteIds, setExpandedExecutionSuiteIds] = useState<string[]>([]);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [expandedExecutionStepGroupIds, setExpandedExecutionStepGroupIds] = useState<string[]>([]);
  const [bulkSelectedStepIds, setBulkSelectedStepIds] = useState<string[]>([]);
  const [executionName, setExecutionName] = useState("");
  const [selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId] = useState("");
  const [selectedExecutionConfigurationId, setSelectedExecutionConfigurationId] = useState("");
  const [selectedExecutionDataSetId, setSelectedExecutionDataSetId] = useState("");
  const [selectedExecutionAssigneeId, setSelectedExecutionAssigneeId] = useState("");
  const [scheduleCadence, setScheduleCadence] = useState<ExecutionScheduleCadence>("weekly");
  const [scheduleNextRunAt, setScheduleNextRunAt] = useState("");
  const [smartExecutionIntegrationId, setSmartExecutionIntegrationId] = useState("");
  const [smartExecutionReleaseScope, setSmartExecutionReleaseScope] = useState("");
  const [smartExecutionAdditionalContext, setSmartExecutionAdditionalContext] = useState("");
  const [selectedSmartRequirementIds, setSelectedSmartRequirementIds] = useState<string[]>([]);
  const [smartExecutionRequirementSearch, setSmartExecutionRequirementSearch] = useState("");
  const [smartExecutionPreview, setSmartExecutionPreview] = useState<SmartExecutionPreviewResponse | null>(null);
  const [selectedSmartExecutionCaseIds, setSelectedSmartExecutionCaseIds] = useState<string[]>([]);
  const [smartExecutionPreviewMessage, setSmartExecutionPreviewMessage] = useState("");
  const [smartExecutionPreviewTone, setSmartExecutionPreviewTone] = useState<"success" | "error">("success");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [activeTab, setActiveTab] = useState<ExecutionTab>("overview");
  const [executionSearch, setExecutionSearch] = useState("");
  const [catalogViewMode, setCatalogViewMode] = useState<"tile" | "list">("tile");
  const [isExecutionListMinimized, setIsExecutionListMinimized] = useState(false);
  const [isSuiteTreeMinimized, setIsSuiteTreeMinimized] = useState(false);
  const [isExecutionHealthExpanded, setIsExecutionHealthExpanded] = useState(true);
  const [isExecutionSupportExpanded, setIsExecutionSupportExpanded] = useState(true);
  const [executionStatusFilter, setExecutionStatusFilter] = useState<ExecutionStatus | "all">("all");
  const [executionIssueFilter, setExecutionIssueFilter] = useState<ExecutionIssueFilter>("all");
  const [executionEvidenceFilter, setExecutionEvidenceFilter] = useState<ExecutionEvidenceFilter>("all");
  const [liveNow, setLiveNow] = useState(() => Date.now());
  const [executionListItemHeight, setExecutionListItemHeight] = useState(236);
  const [caseTimerStartedAtById, setCaseTimerStartedAtById] = useState<Record<string, number>>({});
  const [executionFinalizeAction, setExecutionFinalizeAction] = useState<"complete" | "abort" | null>(null);
  const [uploadingEvidenceStepId, setUploadingEvidenceStepId] = useState("");
  const [executionEvidencePreview, setExecutionEvidencePreview] = useState<ExecutionEvidencePreviewState | null>(null);
  const [isExecutionContextModalOpen, setIsExecutionContextModalOpen] = useState(false);
  const [codePreviewState, setCodePreviewState] = useState<{ title: string; subtitle: string; code: string } | null>(null);
  const [executionAssignmentDraft, setExecutionAssignmentDraft] = useState("");
  const [caseAssignmentDraft, setCaseAssignmentDraft] = useState("");
  const executionCardMeasureRef = useRef<HTMLDivElement | null>(null);
  const deferredExecutionSearch = useDeferredValue(executionSearch);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list
  });
  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: api.users.list,
    enabled: Boolean(session)
  });
  const projectMembersQuery = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => api.projectMembers.list({ project_id: projectId }),
    enabled: Boolean(projectId && session)
  });
  const executionsQuery = useQuery({
    queryKey: ["executions", projectId, appTypeId],
    queryFn: () => api.executions.list(projectId ? { project_id: projectId, app_type_id: appTypeId || undefined } : undefined)
  });
  const executionSchedulesQuery = useQuery({
    queryKey: ["execution-schedules", projectId, appTypeId],
    queryFn: () => api.executionSchedules.list({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined
    }),
    enabled: Boolean(projectId)
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
  const requirementsQuery = useQuery({
    queryKey: ["requirements", projectId],
    queryFn: () => api.requirements.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const smartExecutionCasesQuery = useQuery({
    queryKey: ["smart-execution-cases", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
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
  const integrationsQuery = useQuery({
    queryKey: ["integrations", "llm"],
    queryFn: () => api.integrations.list({ type: "llm", is_active: true }),
    enabled: Boolean(session)
  });
  const workspaceTransactionsQuery = useQuery({
    queryKey: ["workspace-transactions", projectId, appTypeId],
    queryFn: () => api.workspaceTransactions.list({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined,
      limit: 24
    }),
    enabled: Boolean(projectId && session)
  });
  const selectedWorkspaceTransactionEventsQuery = useQuery({
    queryKey: ["workspace-transaction-events", selectedOperationId],
    queryFn: () => api.workspaceTransactions.events(selectedOperationId),
    enabled: Boolean(selectedOperationId && session)
  });

  const createExecution = useMutation({ mutationFn: api.executions.create });
  const updateExecutionAssignment = useMutation({
    mutationFn: ({ id, assigned_to }: { id: string; assigned_to?: string }) => api.executions.update(id, { assigned_to })
  });
  const updateExecutionCaseAssignment = useMutation({
    mutationFn: ({ executionId, testCaseId, assigned_to }: { executionId: string; testCaseId: string; assigned_to?: string }) =>
      api.executions.updateCaseAssignment(executionId, testCaseId, { assigned_to })
  });
  const createExecutionSchedule = useMutation({ mutationFn: api.executionSchedules.create });
  const runExecutionSchedule = useMutation({ mutationFn: api.executionSchedules.run });
  const deleteExecutionSchedule = useMutation({ mutationFn: api.executionSchedules.delete });
  const rerunExecution = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.executions.rerun>[1] }) =>
      api.executions.rerun(id, input)
  });
  const previewSmartExecution = useMutation({ mutationFn: api.executions.previewSmartPlan });
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
  const users = usersQuery.data || [];
  const projectMembers = projectMembersQuery.data || [];
  const executions = executionsQuery.data || [];
  const executionSchedules = executionSchedulesQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const requirements = requirementsQuery.data || [];
  const smartExecutionLibraryCases = smartExecutionCasesQuery.data || [];
  const scopeSuites = scopedSuitesQuery.data || [];
  const executionResults = executionResultsQuery.data || [];
  const allExecutionResults = allExecutionResultsQuery.data || [];
  const integrations = integrationsQuery.data || [];
  const selectedProject = projects.find((project) => project.id === projectId) || null;
  const selectedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;
  const assigneeOptions = useMemo<ExecutionAssigneeOption[]>(
    () => buildAssigneeOptions(projectMembers, users),
    [projectMembers, users]
  );
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
  const workspaceTransactions = useMemo(
    () =>
      (workspaceTransactionsQuery.data || []).filter(
        (transaction) =>
          transaction.category === "bulk_import" ||
          transaction.category === "ai_generation" ||
          transaction.category === "backup"
      ),
    [workspaceTransactionsQuery.data]
  );
  const workspaceTransactionStatusCounts = useMemo(
    () =>
      workspaceTransactions.reduce<Record<string, number>>((accumulator, transaction) => {
        accumulator[transaction.status] = (accumulator[transaction.status] || 0) + 1;
        return accumulator;
      }, {}),
    [workspaceTransactions]
  );
  const filteredWorkspaceTransactions = useMemo(() => {
    const search = deferredExecutionSearch.trim().toLowerCase();

    if (!search) {
      return workspaceTransactions;
    }

    return workspaceTransactions.filter((transaction) =>
      [
        transaction.title,
        transaction.description,
        transaction.status,
        transaction.category,
        transaction.action,
        String(transaction.metadata?.provider || ""),
        String(transaction.metadata?.repository || ""),
        String(transaction.metadata?.file_name || "")
      ].some((value) => String(value || "").toLowerCase().includes(search))
    );
  }, [deferredExecutionSearch, workspaceTransactions]);
  const selectedWorkspaceTransaction = useMemo(
    () => filteredWorkspaceTransactions.find((transaction) => transaction.id === selectedOperationId) || workspaceTransactions.find((transaction) => transaction.id === selectedOperationId) || null,
    [filteredWorkspaceTransactions, selectedOperationId, workspaceTransactions]
  );
  const smartExecutionRequirementOptions = useMemo<SmartExecutionRequirementOption[]>(() => {
    const linkedCaseIdsByRequirementId = smartExecutionLibraryCases.reduce<Map<string, Set<string>>>((accumulator, testCase) => {
      const requirementIds = [...new Set([...(testCase.requirement_ids || []), testCase.requirement_id].filter(Boolean))] as string[];

      requirementIds.forEach((requirementId) => {
        const scopedCaseIds = accumulator.get(requirementId) || new Set<string>();
        scopedCaseIds.add(testCase.id);
        accumulator.set(requirementId, scopedCaseIds);
      });

      return accumulator;
    }, new Map<string, Set<string>>());

    return requirements
      .filter((requirement) => linkedCaseIdsByRequirementId.has(requirement.id))
      .map((requirement) => ({
        id: requirement.id,
        title: requirement.title,
        description: requirement.description,
        linkedCaseCount: linkedCaseIdsByRequirementId.get(requirement.id)?.size || 0
      }))
      .sort((left, right) => {
        if (right.linkedCaseCount !== left.linkedCaseCount) {
          return right.linkedCaseCount - left.linkedCaseCount;
        }

        return left.title.localeCompare(right.title);
      });
  }, [requirements, smartExecutionLibraryCases]);

  useEffect(() => {
    if (testRunsView !== "operations") {
      return;
    }

    if (selectedOperationId && workspaceTransactions.some((transaction) => transaction.id === selectedOperationId)) {
      return;
    }

    setSelectedOperationId(workspaceTransactions[0]?.id || "");
  }, [selectedOperationId, testRunsView, workspaceTransactions]);

  useEffect(() => {
    if (testRunsView !== "scheduled") {
      return;
    }

    if (selectedScheduleId && executionSchedules.some((schedule) => schedule.id === selectedScheduleId)) {
      return;
    }

    setSelectedScheduleId(executionSchedules[0]?.id || "");
  }, [executionSchedules, selectedScheduleId, testRunsView]);

  useEffect(() => {
    const validRequirementIds = new Set(smartExecutionRequirementOptions.map((requirement) => requirement.id));

    setSelectedSmartRequirementIds((current) => {
      const next = current.filter((requirementId) => validRequirementIds.has(requirementId));

      if (next.length === current.length && next.every((requirementId, index) => requirementId === current[index])) {
        return current;
      }

      return next;
    });
  }, [smartExecutionRequirementOptions]);

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const resetSmartExecutionPreview = () => {
    setSmartExecutionPreview(null);
    setSelectedSmartExecutionCaseIds([]);
    setSmartExecutionPreviewMessage("");
    setSmartExecutionPreviewTone("success");
  };

  const closeCreateExecutionModal = () => {
    setIsCreateExecutionModalOpen(false);
  };

  const resetExecutionContextSelection = () => {
    setSelectedExecutionEnvironmentId("");
    setSelectedExecutionConfigurationId("");
    setSelectedExecutionDataSetId("");
  };

  const resetScheduleBuilder = () => {
    setExecutionName("");
    setSelectedSuiteIds([]);
    setSelectedExecutionAssigneeId("");
    setScheduleCadence("weekly");
    setScheduleNextRunAt("");
    resetExecutionContextSelection();
  };

  const resetSmartExecutionBuilder = () => {
    setExecutionCreateMode("manual");
    setSelectedExecutionAssigneeId("");
    setSmartExecutionIntegrationId("");
    setSmartExecutionReleaseScope("");
    setSmartExecutionAdditionalContext("");
    setSelectedSmartRequirementIds([]);
    setSmartExecutionRequirementSearch("");
    resetSmartExecutionPreview();
  };

  const closeExecutionBuilder = () => {
    closeCreateExecutionModal();
    setExecutionName("");
    resetExecutionContextSelection();
    resetSmartExecutionBuilder();
  };

  const closeScheduleBuilder = () => {
    setIsCreateScheduleModalOpen(false);
    resetScheduleBuilder();
  };

  const handleExecutionProjectChange = (value: string) => {
    setProjectId(value);
    setAppTypeId("");
    setSelectedSuiteIds([]);
    setSelectedExecutionAssigneeId("");
    setSelectedSmartRequirementIds([]);
    setSmartExecutionRequirementSearch("");
    resetExecutionContextSelection();
    resetSmartExecutionPreview();
  };

  const handleExecutionAppTypeChange = (value: string) => {
    setAppTypeId(value);
    setSelectedSuiteIds([]);
    setSelectedSmartRequirementIds([]);
    setSmartExecutionRequirementSearch("");
    resetExecutionContextSelection();
    resetSmartExecutionPreview();
  };

  const handleExecutionEnvironmentChange = (value: string) => {
    setSelectedExecutionEnvironmentId(value);
    resetSmartExecutionPreview();
  };

  const handleExecutionConfigurationChange = (value: string) => {
    setSelectedExecutionConfigurationId(value);
    resetSmartExecutionPreview();
  };

  const handleExecutionDataSetChange = (value: string) => {
    setSelectedExecutionDataSetId(value);
    resetSmartExecutionPreview();
  };

  const handleSmartExecutionIntegrationChange = (value: string) => {
    setSmartExecutionIntegrationId(value);
    resetSmartExecutionPreview();
  };

  const handleSmartExecutionReleaseScopeChange = (value: string) => {
    setSmartExecutionReleaseScope(value);
    resetSmartExecutionPreview();
  };

  const handleSmartExecutionAdditionalContextChange = (value: string) => {
    setSmartExecutionAdditionalContext(value);
    resetSmartExecutionPreview();
  };

  const handleToggleSmartExecutionRequirement = (requirementId: string) => {
    setSelectedSmartRequirementIds((current) =>
      current.includes(requirementId) ? current.filter((id) => id !== requirementId) : [...current, requirementId]
    );
    resetSmartExecutionPreview();
  };

  const handleClearSmartExecutionRequirements = () => {
    setSelectedSmartRequirementIds([]);
    resetSmartExecutionPreview();
  };

  const handleSelectSmartExecutionRequirements = (requirementIds: string[]) => {
    setSelectedSmartRequirementIds(requirementIds);
    resetSmartExecutionPreview();
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
    setFocusedSuiteId("");
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
      resetSmartExecutionPreview();
      return;
    }

    if (!appTypes.some((item) => item.id === appTypeId)) {
      setAppTypeId(appTypes[0].id);
      setSelectedSuiteIds([]);
      resetExecutionContextSelection();
      resetSmartExecutionPreview();
    }
  }, [appTypeId, appTypes]);

  useEffect(() => {
    if (!integrations.length) {
      setSmartExecutionIntegrationId("");
      return;
    }

    if (!integrations.some((integration) => integration.id === smartExecutionIntegrationId)) {
      setSmartExecutionIntegrationId(integrations[0].id);
    }
  }, [integrations, smartExecutionIntegrationId]);

  useEffect(() => {
    if (usersQuery.isPending || projectMembersQuery.isPending) {
      return;
    }

    if (selectedExecutionAssigneeId && !assigneeOptions.some((option) => option.id === selectedExecutionAssigneeId)) {
      setSelectedExecutionAssigneeId("");
    }
  }, [assigneeOptions, projectMembersQuery.isPending, selectedExecutionAssigneeId, usersQuery.isPending]);

  useEffect(() => {
    if (usersQuery.isPending || projectMembersQuery.isPending) {
      return;
    }

    if (executionAssignmentDraft && !assigneeOptions.some((option) => option.id === executionAssignmentDraft)) {
      setExecutionAssignmentDraft("");
    }

    if (caseAssignmentDraft && !assigneeOptions.some((option) => option.id === caseAssignmentDraft)) {
      setCaseAssignmentDraft("");
    }
  }, [assigneeOptions, caseAssignmentDraft, executionAssignmentDraft, projectMembersQuery.isPending, usersQuery.isPending]);

  useEffect(() => {
    const requestedExecutionId = searchParams.get("execution");

    if (requestedExecutionId) {
      if (selectedExecutionId !== requestedExecutionId) {
        setSelectedExecutionId(requestedExecutionId);
      }
      return;
    }

    if (selectedExecutionId && !executions.some((execution) => execution.id === selectedExecutionId)) {
      setSelectedExecutionId("");
    }
  }, [executions, searchParams, selectedExecutionId]);

  useEffect(() => {
    if (testRunsView === "scheduled") {
      setSelectedExecutionId("");
      setFocusedSuiteId("");
      setSelectedTestCaseId("");
      syncExecutionSearchParams("", null);
    }
  }, [testRunsView]);

  const selectedExecution = selectedExecutionQuery.data || executions.find((execution) => execution.id === selectedExecutionId) || null;
  const selectedSchedule = executionSchedules.find((schedule) => schedule.id === selectedScheduleId) || null;
  const selectedExecutionSuiteIds = selectedExecution?.suite_ids || [];
  const selectedExecutionSuites = selectedExecution?.suite_snapshots || [];
  const currentExecutionStatus = normalizeExecutionStatus(selectedExecution?.status);
  const isExecutionScopeReadOnly = testRunsView === "executions" && Boolean(selectedExecution);
  const isExecutionStarted = currentExecutionStatus === "running";
  const isExecutionLocked =
    currentExecutionStatus === "completed" || currentExecutionStatus === "failed" || currentExecutionStatus === "aborted";
  const snapshotCases = useMemo(
    () => ((selectedExecution?.case_snapshots || []).slice().sort((left, right) => left.sort_order - right.sort_order)),
    [selectedExecution?.case_snapshots]
  );
  const snapshotSteps = selectedExecution?.step_snapshots || [];
  const hasExecutionLevelTestData = Boolean(selectedExecution?.test_data_set);
  const selectedExecutionCaseSnapshot = useMemo(
    () => snapshotCases.find((snapshot) => snapshot.test_case_id === selectedTestCaseId) || null,
    [selectedTestCaseId, snapshotCases]
  );
  const executionStepParameterValues = useMemo(
    () =>
      hasExecutionLevelTestData
        ? buildDataSetParameterValues(selectedExecution?.test_data_set?.snapshot || null)
        : selectedExecutionCaseSnapshot?.parameter_values || {},
    [hasExecutionLevelTestData, selectedExecution?.test_data_set?.snapshot, selectedExecutionCaseSnapshot?.parameter_values]
  );
  const selectedExecutionCaseParameterEntries = useMemo(
    () => Object.entries(selectedExecutionCaseSnapshot?.parameter_values || {}).sort(([left], [right]) => left.localeCompare(right)),
    [selectedExecutionCaseSnapshot?.parameter_values]
  );

  useEffect(() => {
    setExecutionAssignmentDraft(selectedExecution?.assigned_to || "");
  }, [selectedExecution?.assigned_to, selectedExecution?.id]);

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

  useEffect(() => {
    setExpandedExecutionSuiteIds([]);
  }, [selectedExecutionId]);

  useEffect(() => {
    if (!selectedExecution) {
      return;
    }

    if (selectedExecution.project_id && selectedExecution.project_id !== projectId) {
      setProjectId(selectedExecution.project_id);
    }

    if (selectedExecution.app_type_id && selectedExecution.app_type_id !== appTypeId) {
      setAppTypeId(selectedExecution.app_type_id);
    }
  }, [appTypeId, projectId, selectedExecution, setProjectId]);

  useEffect(() => {
    setExpandedExecutionStepGroupIds([]);
  }, [selectedExecutionId, selectedTestCaseId]);

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
  const executionStepBlocks = useMemo<ExecutionStepBlock[]>(
    () =>
      selectedSteps.reduce<ExecutionStepBlock[]>((blocks, step) => {
        const previousBlock = blocks[blocks.length - 1];

        if (step.group_id && previousBlock?.groupId === step.group_id) {
          previousBlock.steps.push(step);
          return blocks;
        }

        blocks.push({
          key: step.group_id ? `group-${step.group_id}` : `step-${step.id}`,
          groupId: step.group_id || null,
          groupName: step.group_name || null,
          groupKind: step.group_kind || null,
          steps: [step]
        });

        return blocks;
      }, []),
    [selectedSteps]
  );
  const executionStepGroupIds = useMemo(
    () => executionStepBlocks.map((block) => block.groupId).filter((groupId): groupId is string => Boolean(groupId)),
    [executionStepBlocks]
  );

  useEffect(() => {
    const requestedTestCaseId = searchParams.get("testCase");

    if (requestedTestCaseId && executionCaseOrder.some((testCase) => testCase.id === requestedTestCaseId)) {
      const requestedSuiteId = executionCaseOrder.find((testCase) => testCase.id === requestedTestCaseId)?.suite_id;

      if (requestedSuiteId) {
        setFocusedSuiteId(requestedSuiteId);
      }

      if (selectedTestCaseId !== requestedTestCaseId) {
        setSelectedTestCaseId(requestedTestCaseId);
      }
      return;
    }

    if (selectedTestCaseId && executionCaseOrder.some((testCase) => testCase.id === selectedTestCaseId)) {
      const selectedSuiteId = executionCaseOrder.find((testCase) => testCase.id === selectedTestCaseId)?.suite_id;
      if (selectedSuiteId && focusedSuiteId !== selectedSuiteId) {
        setFocusedSuiteId(selectedSuiteId);
      }
      return;
    }

    if (selectedTestCaseId) {
      setSelectedTestCaseId("");
    }
  }, [executionCaseOrder, focusedSuiteId, searchParams, selectedTestCaseId]);

  useEffect(() => {
    if (!executionSuites.length) {
      setFocusedSuiteId("");
      return;
    }

    setFocusedSuiteId((current) => (current && executionSuites.some((suite) => suite.id === current) ? current : ""));
  }, [executionSuites]);

  useEffect(() => {
    const validSuiteIds = new Set(executionSuites.map((suite) => suite.id));
    setExpandedExecutionSuiteIds((current) => current.filter((suiteId) => validSuiteIds.has(suiteId)));
  }, [executionSuites]);

  useEffect(() => {
    const validGroupIds = new Set(executionStepGroupIds);
    setExpandedExecutionStepGroupIds((current) => current.filter((groupId) => validGroupIds.has(groupId)));
  }, [executionStepGroupIds]);

  useEffect(() => {
    if (!selectedTestCaseId || !focusedSuiteId) {
      return;
    }

    setExpandedExecutionSuiteIds((current) =>
      current.includes(focusedSuiteId) ? current : [...current, focusedSuiteId]
    );
  }, [focusedSuiteId, selectedTestCaseId]);

  useEffect(() => {
    setBulkSelectedStepIds([]);
    setActiveTab("overview");
    setExecutionEvidencePreview(null);
  }, [selectedExecutionId, selectedTestCaseId]);

  useEffect(() => {
    setIsExecutionContextModalOpen(false);
  }, [selectedExecutionId]);

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
  const stepEvidence = selectedCaseLogs.stepEvidence || {};

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

  const focusedExecutionSuite = useMemo(
    () => executionSuites.find((suite) => suite.id === focusedSuiteId) || null,
    [executionSuites, focusedSuiteId]
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

  const refreshExecutionSchedules = async () => {
    await queryClient.invalidateQueries({ queryKey: ["execution-schedules"] });
  };

  const handleSaveExecutionAssignment = async () => {
    if (!selectedExecution) {
      return;
    }

    try {
      await updateExecutionAssignment.mutateAsync({
        id: selectedExecution.id,
        assigned_to: executionAssignmentDraft || ""
      });
      await refreshExecutionScope(selectedExecution.id);
      showSuccess(
        executionAssignmentDraft
          ? "Execution assignee updated. Unoverridden test cases now follow this owner."
          : "Execution assignee cleared."
      );
    } catch (error) {
      showError(error, "Unable to update execution assignee");
    }
  };

  const handleSaveCaseAssignment = async () => {
    if (!selectedExecution || !selectedExecutionCase) {
      return;
    }

    try {
      await updateExecutionCaseAssignment.mutateAsync({
        executionId: selectedExecution.id,
        testCaseId: selectedExecutionCase.id,
        assigned_to: caseAssignmentDraft || ""
      });
      await refreshExecutionScope(selectedExecution.id);
      showSuccess(
        caseAssignmentDraft
          ? "Test case assignee updated for this execution."
          : selectedExecution.assigned_user
            ? "Test case assignee reset to the execution owner."
            : "Test case assignee cleared."
      );
    } catch (error) {
      showError(error, "Unable to update test case assignee");
    }
  };

  const handleFinalizeExecution = async (mode: "complete" | "abort") => {
    if (!selectedExecution) {
      return;
    }

    const status = mode === "abort" ? "aborted" : executionProgress.failedCount ? "failed" : "completed";
    const failureMessage = mode === "abort" ? "Unable to abort execution" : "Unable to complete execution";

    setExecutionFinalizeAction(mode);

    try {
      await completeExecution.mutateAsync({ id: selectedExecution.id, status });
      await refreshExecutionScope();
    } catch (error) {
      showError(error, failureMessage);
    } finally {
      setExecutionFinalizeAction(null);
    }
  };

  const handlePreviewSmartExecution = async () => {
    if (!projectId || !appTypeId) {
      setSmartExecutionPreviewTone("error");
      setSmartExecutionPreviewMessage("Choose a project and app type before generating an AI smart execution.");
      return;
    }

    if (!smartExecutionReleaseScope.trim() && !smartExecutionAdditionalContext.trim()) {
      setSmartExecutionPreviewTone("error");
      setSmartExecutionPreviewMessage("Add release scope or additional context so AI can identify impacted test coverage.");
      return;
    }

    try {
      const response = await previewSmartExecution.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId,
        integration_id: smartExecutionIntegrationId || undefined,
        release_scope: smartExecutionReleaseScope || undefined,
        additional_context: smartExecutionAdditionalContext || undefined,
        impacted_requirement_ids: selectedSmartRequirementIds.length ? selectedSmartRequirementIds : undefined,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined
      });

      setSmartExecutionPreview(response);
      setSelectedSmartExecutionCaseIds(response.cases.map((testCase) => testCase.test_case_id));
      setExecutionName(response.execution_name || executionName);
      setSmartExecutionPreviewTone("success");
      setSmartExecutionPreviewMessage(
        response.cases.length
          ? `${response.matched_case_count} impacted case${response.matched_case_count === 1 ? "" : "s"} identified from ${response.source_case_count} existing case${response.source_case_count === 1 ? "" : "s"} using ${response.integration.name}${selectedSmartRequirementIds.length ? ` and ${selectedSmartRequirementIds.length} selected requirement${selectedSmartRequirementIds.length === 1 ? "" : "s"}` : ""}.`
          : `No impacted cases were identified using ${response.integration.name}. Refine the release scope, add context, or try a narrower requirement filter.`
      );
    } catch (error) {
      resetSmartExecutionPreview();
      setSmartExecutionPreviewTone("error");
      setSmartExecutionPreviewMessage(error instanceof Error ? error.message : "Unable to generate a smart execution preview");
    }
  };

  const handleCreateExecution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session?.user.id) {
      setMessageTone("error");
      setMessage("You need an active session before creating an execution.");
      return;
    }

    const selectedSmartCaseIds = selectedSmartExecutionCases.map((testCase) => testCase.test_case_id);

    if (executionCreateMode === "smart" && !selectedSmartCaseIds.length) {
      setMessageTone("error");
      setMessage("Select at least one impacted test case before creating an AI smart execution.");
      return;
    }

    try {
      const response = await createExecution.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId || undefined,
        suite_ids: executionCreateMode === "manual" ? selectedSuiteIds : undefined,
        test_case_ids: executionCreateMode === "smart" ? selectedSmartCaseIds : undefined,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined,
        assigned_to: selectedExecutionAssigneeId || undefined,
        name: executionName || undefined,
        created_by: session.user.id
      });

      closeExecutionBuilder();
      focusExecution(response.id);
      setFocusedSuiteId("");
      showSuccess(
        executionCreateMode === "smart"
          ? `AI smart execution created with ${selectedSmartCaseIds.length} impacted case${selectedSmartCaseIds.length === 1 ? "" : "s"} under Default.`
          : "Execution created from a snapshot of the selected suites."
      );
      await refreshExecutionScope(response.id);
    } catch (error) {
      showError(error, "Unable to create execution");
    }
  };

  const handleCreateExecutionSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session?.user.id) {
      showError(new Error("You need an active session before creating a schedule."), "Unable to create schedule");
      return;
    }

    if (!projectId || !appTypeId) {
      showError(new Error("Choose a project and app type before creating a schedule."), "Unable to create schedule");
      return;
    }

    if (!selectedSuiteIds.length) {
      showError(new Error("Select at least one suite to schedule."), "Unable to create schedule");
      return;
    }

    if (!scheduleNextRunAt) {
      showError(new Error("Choose the first run time for this schedule."), "Unable to create schedule");
      return;
    }

    try {
      await createExecutionSchedule.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId,
        name: executionName || undefined,
        cadence: scheduleCadence,
        next_run_at: new Date(scheduleNextRunAt).toISOString(),
        suite_ids: selectedSuiteIds,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined,
        assigned_to: selectedExecutionAssigneeId || undefined,
        created_by: session.user.id
      });

      closeScheduleBuilder();
      setTestRunsView("scheduled");
      await refreshExecutionSchedules();
      showSuccess("Scheduled execution created.");
    } catch (error) {
      showError(error, "Unable to create schedule");
    }
  };

  const handleRerunExecutionItem = async (execution: Execution, failedOnly: boolean) => {
    if (!session?.user.id) {
      return;
    }

    try {
      const response = await rerunExecution.mutateAsync({
        id: execution.id,
        input: {
          failed_only: failedOnly,
          created_by: session.user.id
        }
      });

      focusExecution(response.id);
      await refreshExecutionScope(response.id);
      showSuccess(failedOnly ? "Failed cases were queued into a fresh rerun execution." : "A fresh rerun execution was created with the same execution context.");
    } catch (error) {
      showError(error, failedOnly ? "Unable to rerun failed cases" : "Unable to rerun execution");
    }
  };

  const handleRerunExecution = async (failedOnly: boolean) => {
    if (!selectedExecution) {
      return;
    }

    await handleRerunExecutionItem(selectedExecution, failedOnly);
  };

  const handleRunExecutionSchedule = async (scheduleId: string) => {
    try {
      const response = await runExecutionSchedule.mutateAsync(scheduleId);
      setTestRunsView("executions");
      focusExecution(response.id);
      await Promise.all([refreshExecutionScope(response.id), refreshExecutionSchedules()]);
      showSuccess("Scheduled execution was launched as a fresh run.");
    } catch (error) {
      showError(error, "Unable to run the schedule");
    }
  };

  const handleDeleteExecutionSchedule = async (scheduleId: string, scheduleName: string) => {
    if (!window.confirm(`Delete schedule "${scheduleName}"?`)) {
      return;
    }

    try {
      await deleteExecutionSchedule.mutateAsync(scheduleId);
      if (selectedScheduleId === scheduleId) {
        setSelectedScheduleId("");
      }
      await refreshExecutionSchedules();
      showSuccess("Scheduled execution removed.");
    } catch (error) {
      showError(error, "Unable to delete schedule");
    }
  };

  const persistCaseResult = async (
    testCaseId: string,
    patches: {
      stepStatusesPatch?: Record<string, ExecutionStepStatus>;
      stepNotesPatch?: Record<string, string>;
      stepEvidencePatch?: Record<string, ExecutionStepEvidence | null>;
    }
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
    const mergedEvidence = mergeExecutionEvidencePatch(prev.stepEvidence || {}, patches.stepEvidencePatch);

    const caseStepIds = (stepsByCaseId[testCaseId] || [])
      .slice()
      .sort((left, right) => left.step_order - right.step_order)
      .map((step) => step.id);
    const aggregateStatus = deriveCaseStatusFromSteps(caseStepIds, mergedStatuses);
    const logs = stringifyExecutionLogs({ stepStatuses: mergedStatuses, stepNotes: mergedNotes, stepEvidence: mergedEvidence });
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
      Object.keys(patches.stepStatusesPatch || {}).length > 0
      || Object.keys(patches.stepNotesPatch || {}).length > 0
      || Object.keys(patches.stepEvidencePatch || {}).length > 0;
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
          if (nextCase.suite_id) {
            setFocusedSuiteId(nextCase.suite_id);
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

  const openExecutionEvidence = (step: TestStep, evidence: ExecutionStepEvidence) => {
    setExecutionEvidencePreview({
      stepLabel: `Step ${step.step_order}`,
      fileName: evidence.fileName || null,
      dataUrl: evidence.dataUrl
    });
  };

  const handleUploadStepEvidence = async (step: TestStep, file: File) => {
    if (!selectedExecution || !selectedTestCaseId) {
      return;
    }

    setUploadingEvidenceStepId(step.id);

    try {
      const evidence = await readExecutionEvidenceImage(file);
      await persistCaseResult(selectedTestCaseId, { stepEvidencePatch: { [step.id]: evidence } });
      showSuccess(stepEvidence[step.id]?.dataUrl ? "Evidence image replaced." : "Evidence image saved.");
    } catch (error) {
      showError(error, "Unable to save evidence image");
    } finally {
      setUploadingEvidenceStepId((current) => (current === step.id ? "" : current));
    }
  };

  const handleDeleteStepEvidence = async (step: TestStep) => {
    if (!selectedExecution || !selectedTestCaseId) {
      return;
    }

    try {
      await persistCaseResult(selectedTestCaseId, { stepEvidencePatch: { [step.id]: null } });
      showSuccess("Evidence image removed.");
    } catch (error) {
      showError(error, "Unable to delete evidence image");
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
  const selectedExecutionCaseEffectiveUser = selectedExecutionCase?.assigned_user || selectedExecution?.assigned_user || null;
  const selectedExecutionCaseExplicitAssigneeId = selectedExecutionCase?.assigned_to || "";

  const openExecutionCaseAutomationPreview = () => {
    if (!selectedSteps.length) {
      return;
    }

    setCodePreviewState({
      title: `${selectedExecutionCase?.title || "Selected case"} automation`,
      subtitle: "Execution snapshots are read-only here. Update the source test case or shared group to change this code.",
      code: buildCaseAutomationCode(selectedExecutionCase?.title || "Selected case", selectedSteps)
    });
  };

  const openExecutionGroupAutomationPreview = (groupName: string, steps: TestStep[]) => {
    setCodePreviewState({
      title: `${groupName} automation`,
      subtitle: "This is the snapped automation for the selected execution.",
      code: buildGroupAutomationCode(groupName, steps)
    });
  };

  const openExecutionStepAutomationPreview = (step: TestStep) => {
    setCodePreviewState({
      title: `Step ${step.step_order} automation`,
      subtitle: "Execution snapshots are read-only. This preview reflects the preserved step automation for this run.",
      code: resolveStepAutomationCode(step)
    });
  };

  useEffect(() => {
    setCaseAssignmentDraft(selectedExecutionCaseExplicitAssigneeId);
  }, [selectedExecutionCase?.id, selectedExecutionCaseExplicitAssigneeId]);

  useEffect(() => {
    setCodePreviewState(null);
  }, [selectedExecutionId, selectedTestCaseId]);

  const focusExecutionCase = (testCaseId: string, executionId = selectedExecutionId) => {
    const scopedCase = executionCaseOrder.find((testCase) => testCase.id === testCaseId);

    if (scopedCase?.suite_id) {
      setFocusedSuiteId(scopedCase.suite_id);
    }

    if (executionId && executionId !== selectedExecutionId) {
      setSelectedExecutionId(executionId);
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
  const resolvedStepImageCount = useMemo(
    () => Object.values(stepEvidence).filter((value) => Boolean(value?.dataUrl)).length,
    [stepEvidence]
  );
  const resolvedEvidenceArtifactCount = resolvedStepNoteCount + resolvedStepImageCount;

  const selectedExecutionAppTypeLabel =
    appTypeNameById[selectedExecution?.app_type_id || ""] || selectedExecution?.app_type_id || "No app type scoped";
  const selectedExecutionProjectLabel =
    projectNameById[selectedExecution?.project_id || ""] ||
    projects.find((project) => project.id === selectedExecution?.project_id)?.name ||
    selectedExecution?.project_id ||
    "No project scoped";
  const hasExecutionAssignmentChange = executionAssignmentDraft !== (selectedExecution?.assigned_to || "");
  const hasCaseAssignmentChange = caseAssignmentDraft !== selectedExecutionCaseExplicitAssigneeId;
  const selectedExecutionCaseAssignmentHint = selectedExecutionCase?.assigned_to
    ? "This case has its own execution-level assignee override."
    : selectedExecution?.assigned_user
      ? `This case is currently following ${resolveUserPrimaryLabel(selectedExecution.assigned_user)} from the execution.`
      : "No assignee is set yet for this execution or this case.";
  const remainingCaseCount = Math.max(executionProgress.totalCases - executionProgress.completedCases, 0);
  const selectedCaseStatusLabel = selectedExecutionCase ? caseDerivedStatus(selectedExecutionCase) : executionProgress.derivedStatus;
  const activeExecutionStage = selectedExecutionCase ? "case" : selectedExecution ? "suites" : "executions";
  const showExecutionListHeader =
    testRunsView === "scheduled"
      ? !selectedSchedule
      : testRunsView === "operations"
        ? !selectedWorkspaceTransaction
        : !selectedExecution;
  const executionControlTitle =
    currentExecutionStatus === "running"
      ? "Execution is live"
      : currentExecutionStatus === "queued"
        ? "Execution ready to start"
        : currentExecutionStatus === "aborted"
          ? "Execution was aborted"
          : "Execution locked";
  const executionControlDescription =
    currentExecutionStatus === "running"
      ? `${formatDuration(selectedExecutionDurationMs, DEFAULT_DURATION_LABEL)} elapsed across the run.`
      : currentExecutionStatus === "queued"
        ? "Start the run before step-level result capture."
        : currentExecutionStatus === "aborted"
          ? "This execution was stopped early. Captured evidence remains available for review."
          : "This execution has been completed. Evidence remains available for review.";

  const closeExecutionDrilldown = () => {
    setSelectedExecutionId("");
    setFocusedSuiteId("");
    setSelectedTestCaseId("");
    syncExecutionSearchParams("", null);
  };

  const closeCaseDrilldown = () => {
    setSelectedTestCaseId("");
    syncExecutionSearchParams(selectedExecutionId, null);
  };

  const toggleSuiteGroup = (suiteId: string) => {
    setFocusedSuiteId(suiteId);
    setExpandedExecutionSuiteIds((current) =>
      current.includes(suiteId)
        ? current.filter((id) => id !== suiteId)
        : [...current, suiteId]
    );
  };

  const executionStatusOptions = useMemo(
    () => Array.from(new Set(executions.map((execution) => normalizeExecutionStatus(execution.status)))),
    [executions]
  );

  const filteredExecutions = useMemo(() => {
    const search = deferredExecutionSearch.trim().toLowerCase();

    return executions.filter((execution) => {
      const projectName = projectNameById[execution.project_id] || "";
      const assigneeLabel = execution.assigned_user ? resolveUserPrimaryLabel(execution.assigned_user) : "";
      const summary = executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY;
      const executionStatus = normalizeExecutionStatus(execution.status);
      const hasIssues = summary.failed + summary.blocked > 0;
      const hasEvidence = summary.total > 0;
      const matchesSearch = !search || [execution.name || "", projectName, assigneeLabel].some((value) => value.toLowerCase().includes(search));

      if (!matchesSearch) {
        return false;
      }

      if (executionStatusFilter !== "all" && executionStatus !== executionStatusFilter) {
        return false;
      }

      if (executionIssueFilter === "with-issues" && !hasIssues) {
        return false;
      }

      if (executionIssueFilter === "clean" && hasIssues) {
        return false;
      }

      if (executionEvidenceFilter === "with-evidence" && !hasEvidence) {
        return false;
      }

      if (executionEvidenceFilter === "no-evidence" && hasEvidence) {
        return false;
      }

      return true;
    });
  }, [deferredExecutionSearch, executionEvidenceFilter, executionIssueFilter, executionStatusFilter, executionSummaryById, executions, projectNameById]);

  const filteredSchedules = useMemo(() => {
    const search = deferredExecutionSearch.trim().toLowerCase();

    return executionSchedules.filter((schedule) => {
      const appTypeName = appTypeNameById[schedule.app_type_id || ""] || "";
      const assigneeLabel = schedule.assigned_user ? resolveUserPrimaryLabel(schedule.assigned_user) : "";
      const nextRunLabel = schedule.next_run_at || "";

      return !search || [schedule.name, appTypeName, assigneeLabel, nextRunLabel].some((value) => value.toLowerCase().includes(search));
    });
  }, [appTypeNameById, deferredExecutionSearch, executionSchedules]);
  const executionListColumns = useMemo<Array<DataTableColumn<Execution>>>(() => [
    {
      key: "execution",
      label: "Execution",
      canToggle: false,
      render: (execution) => <strong>{execution.name || "Unnamed execution"}</strong>
    },
    {
      key: "trigger",
      label: "Trigger",
      defaultVisible: false,
      render: (execution) => execution.trigger || "manual"
    },
    {
      key: "status",
      label: "Status",
      render: (execution) => executionStatusLabel(execution.status)
    },
    {
      key: "assignee",
      label: "Assignee",
      render: (execution) => (execution.assigned_user ? resolveUserPrimaryLabel(execution.assigned_user) : "Unassigned")
    },
    {
      key: "suites",
      label: "Suites",
      render: (execution) => execution.suite_ids.length
    },
    {
      key: "touched",
      label: "Touched",
      render: (execution) => {
        const summary = executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY;
        const totalCases = (execution.case_snapshots || []).length;
        return totalCases ? `${summary.total}/${totalCases}` : summary.total;
      }
    },
    {
      key: "issues",
      label: "Issues",
      render: (execution) => {
        const summary = executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY;
        return summary.failed + summary.blocked;
      }
    },
    {
      key: "started",
      label: "Started",
      render: (execution) => formatExecutionTimestamp(execution.started_at, "Not started yet")
    },
    {
      key: "duration",
      label: "Duration",
      render: (execution) => formatDuration(computeExecutionDurationMs(execution.started_at, execution.ended_at, liveNow), DEFAULT_DURATION_LABEL)
    },
    {
      key: "latestActivity",
      label: "Latest activity",
      defaultVisible: false,
      render: (execution) => {
        const summary = executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY;
        return formatExecutionTimestamp(summary.latestActivityAt, "No evidence yet");
      }
    },
    {
      key: "actions",
      label: "Actions",
      canToggle: false,
      render: (execution) => {
        const summary = executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY;

        return (
          <div onClick={(event) => event.stopPropagation()}>
            <CatalogActionMenu
              actions={[
                {
                  label: "Open run",
                  description: "Open this execution and review its evidence.",
                  icon: <OpenIcon />,
                  onClick: () => {
                    setTestRunsView("executions");
                    focusExecution(execution.id);
                  }
                },
                {
                  label: "Rerun execution",
                  description: "Create a fresh execution with the same scope.",
                  icon: <PlayIcon />,
                  onClick: () => void handleRerunExecutionItem(execution, false),
                  disabled: !session?.user.id || rerunExecution.isPending
                },
                {
                  label: "Rerun failed",
                  description: summary.failed
                    ? `Create a new run using the ${summary.failed} failed case${summary.failed === 1 ? "" : "s"}.`
                    : "No failed cases are available for a targeted rerun.",
                  icon: <PlayIcon />,
                  onClick: () => void handleRerunExecutionItem(execution, true),
                  disabled: !session?.user.id || !summary.failed || rerunExecution.isPending
                }
              ]}
              label={`${execution.name || "Execution"} actions`}
            />
          </div>
        );
      }
    }
  ], [executionSummaryById, handleRerunExecutionItem, liveNow, rerunExecution.isPending, session?.user.id]);
  const executionScheduleListColumns = useMemo<Array<DataTableColumn<ExecutionSchedule>>>(() => [
    {
      key: "schedule",
      label: "Schedule",
      canToggle: false,
      render: (schedule) => <strong>{schedule.name}</strong>
    },
    {
      key: "status",
      label: "Status",
      render: (schedule) => (schedule.is_active ? "Active" : "Inactive")
    },
    {
      key: "cadence",
      label: "Cadence",
      render: (schedule) => schedule.cadence
    },
    {
      key: "assignee",
      label: "Assignee",
      render: (schedule) => (schedule.assigned_user ? resolveUserPrimaryLabel(schedule.assigned_user) : "Unassigned")
    },
    {
      key: "suites",
      label: "Suites",
      render: (schedule) => schedule.suite_ids.length
    },
    {
      key: "directCases",
      label: "Direct cases",
      render: (schedule) => schedule.test_case_ids.length
    },
    {
      key: "nextRun",
      label: "Next run",
      render: (schedule) => formatExecutionTimestamp(schedule.next_run_at, "Not scheduled")
    },
    {
      key: "lastRun",
      label: "Last run",
      defaultVisible: false,
      render: (schedule) => formatExecutionTimestamp(schedule.last_run_at, "No runs yet")
    },
    {
      key: "actions",
      label: "Actions",
      canToggle: false,
      render: (schedule) => (
        <div onClick={(event) => event.stopPropagation()}>
          <CatalogActionMenu
            actions={[
              {
                label: "Open schedule",
                description: "Review cadence, suites, and direct cases for this schedule.",
                icon: <CalendarIcon />,
                onClick: () => {
                  setTestRunsView("scheduled");
                  setSelectedScheduleId(schedule.id);
                }
              },
              {
                label: "Run now",
                description: "Launch this schedule immediately as a fresh execution.",
                icon: <PlayIcon />,
                onClick: () => void handleRunExecutionSchedule(schedule.id)
              },
              {
                label: "Delete schedule",
                description: "Remove this schedule from future execution planning.",
                icon: <TrashIcon />,
                onClick: () => void handleDeleteExecutionSchedule(schedule.id, schedule.name),
                tone: "danger" as const
              }
            ]}
            label={`${schedule.name} actions`}
          />
        </div>
      )
    }
  ], [handleDeleteExecutionSchedule, handleRunExecutionSchedule]);
  const operationListColumns = useMemo<Array<DataTableColumn<WorkspaceTransaction>>>(() => [
    {
      key: "operation",
      label: "Operation",
      canToggle: false,
      render: (transaction) => {
        const presentation = describeWorkspaceTransaction(transaction, {
          appTypeNameById,
          projectNameById
        });

        return (
          <div className="data-table-multiline">
            <strong>{transaction.title}</strong>
            <span className="data-table-multiline-line">{presentation.eyebrow}</span>
          </div>
        );
      }
    },
    {
      key: "status",
      label: "Status",
      render: (transaction) => transaction.status
    },
    {
      key: "provider",
      label: "Provider",
      defaultVisible: false,
      render: (transaction) => String(transaction.metadata?.provider || transaction.category).replace(/_/g, " ")
    },
    {
      key: "events",
      label: "Events",
      render: (transaction) => transaction.event_count || 0
    },
    {
      key: "updated",
      label: "Last activity",
      render: (transaction) => formatExecutionTimestamp(transaction.latest_event_at || transaction.updated_at || transaction.completed_at || transaction.created_at, "Not recorded")
    },
    {
      key: "actions",
      label: "Actions",
      canToggle: false,
      render: (transaction) => (
        <div onClick={(event) => event.stopPropagation()}>
          <CatalogActionMenu
            actions={[
              {
                label: "Open operation",
                description: "Inspect transaction metadata and event logs.",
                icon: <ActivityIcon />,
                onClick: () => {
                  setTestRunsView("operations");
                  setSelectedOperationId(transaction.id);
                }
              }
            ]}
            label={`${transaction.title} actions`}
          />
        </div>
      )
    }
  ], [appTypeNameById, projectNameById]);

  const activeExecutionFilterCount =
    Number(executionStatusFilter !== "all") +
    Number(executionIssueFilter !== "all") +
    Number(executionEvidenceFilter !== "all");

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

  const smartPreviewCases = smartExecutionPreview?.cases || [];
  const selectedSmartExecutionCases = useMemo(
    () => smartPreviewCases.filter((testCase) => selectedSmartExecutionCaseIds.includes(testCase.test_case_id)),
    [selectedSmartExecutionCaseIds, smartPreviewCases]
  );
  const canCreateExecution =
    executionCreateMode === "smart"
      ? Boolean(projectId && appTypeId && selectedSmartExecutionCases.length)
      : Boolean(projectId && appTypeId && selectedSuiteIds.length);

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
    const logs = stringifyExecutionLogs({
      stepStatuses: prev.stepStatuses || {},
      stepNotes: prev.stepNotes || {},
      stepEvidence: prev.stepEvidence || {}
    });
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
      {showExecutionListHeader ? (
        <PageHeader
          eyebrow="Test Runs"
          title={
            testRunsView === "executions"
              ? "Test Executions"
              : testRunsView === "scheduled"
                ? "Scheduled Executions"
                : "Operations Activity"
          }
          description={
            testRunsView === "executions"
              ? "Launch scoped runs, monitor live progress, and capture failure evidence without losing the surrounding suite and case context."
              : testRunsView === "scheduled"
                ? "Plan recurring release checks separately from live runs so teams can see what is scheduled next without cluttering the active execution board."
                : "Review imports, scheduled AI generation, and project backup syncs with full traceable logs."
          }
          meta={[
            {
              label: testRunsView === "executions" ? "Runs" : testRunsView === "scheduled" ? "Schedules" : "Operations",
              value: testRunsView === "executions" ? executions.length : testRunsView === "scheduled" ? executionSchedules.length : workspaceTransactions.length
            },
            {
              label: testRunsView === "executions" ? "Blocking cases" : testRunsView === "scheduled" ? "Active schedules" : "Running now",
              value:
                testRunsView === "executions"
                  ? blockingCases.length
                  : testRunsView === "scheduled"
                    ? executionSchedules.filter((schedule) => schedule.is_active).length
                    : workspaceTransactionStatusCounts.running || 0
            },
            {
              label: testRunsView === "executions" ? "Completion" : testRunsView === "scheduled" ? "Next due" : "Failures",
              value:
                testRunsView === "executions"
                  ? `${executionProgress.percent}%`
                  : testRunsView === "scheduled"
                    ? (filteredSchedules[0]?.next_run_at ? formatExecutionTimestamp(filteredSchedules[0].next_run_at, "Not set") : "Not set")
                    : workspaceTransactionStatusCounts.failed || 0
            }
          ]}
          actions={
            testRunsView === "operations" ? undefined : (
              <>
                <button
                  className="ghost-button"
                  onClick={() => {
                    if (!scheduleNextRunAt) {
                      const nextHour = new Date();
                      nextHour.setMinutes(0, 0, 0);
                      nextHour.setHours(nextHour.getHours() + 1);
                      setScheduleNextRunAt(nextHour.toISOString().slice(0, 16));
                    }
                    setIsCreateScheduleModalOpen(true);
                  }}
                  type="button"
                >
                  <CalendarIcon />
                  Schedule Execution
                </button>
                <button className="primary-button" onClick={() => setIsCreateExecutionModalOpen(true)} type="button">
                  <PlayIcon />
                  Create Execution
                </button>
              </>
            )
          }
        />
      ) : null}

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      <SubnavTabs
        ariaLabel="Test runs views"
        items={[
          { value: "executions", label: "Executions", meta: `${executions.length}`, icon: <ExecutionRunIcon /> },
          { value: "scheduled", label: "Scheduled", meta: `${executionSchedules.length}`, icon: <ExecutionScheduleIcon /> },
          { value: "operations", label: "Operations", meta: `${workspaceTransactions.length}`, icon: <ActivityIcon /> }
        ]}
        onChange={setTestRunsView}
        value={testRunsView}
      />

      <WorkspaceScopeBar
        appTypeId={testRunsView === "executions" ? selectedExecution?.app_type_id || appTypeId : appTypeId}
        appTypes={appTypes}
        appTypeValueLabel={testRunsView === "executions" && selectedExecution ? selectedExecutionAppTypeLabel : undefined}
        disabled={isExecutionScopeReadOnly}
        onAppTypeChange={(value) => {
          setAppTypeId(value);
          setSelectedSuiteIds([]);
          resetExecutionContextSelection();
        }}
        onProjectChange={(value) => {
          setProjectId(value);
          setAppTypeId("");
          setSelectedSuiteIds([]);
          resetExecutionContextSelection();
        }}
        projectId={testRunsView === "executions" ? selectedExecution?.project_id || projectId : projectId}
        projectValueLabel={testRunsView === "executions" && selectedExecution ? selectedExecutionProjectLabel : undefined}
        projects={projects}
      />

      <WorkspaceMasterDetail
        browseView={(
          <Panel
            className="execution-panel execution-panel--list"
            title={
              testRunsView === "executions"
                ? "Execution tiles"
                : testRunsView === "scheduled"
                  ? "Scheduled runs"
                  : "Operations stream"
            }
            subtitle={
              testRunsView === "executions"
                ? "Start from the run catalog, then drill into suites, cases, and step execution one focused screen at a time."
                : testRunsView === "scheduled"
                  ? "Keep recurring release checks separate from live runs, then launch one instantly when the team is ready."
                  : "Inspect imports, AI generation, and backup syncs as traceable operational records."
            }
          >
            <div className="design-list-toolbar">
              <CatalogViewToggle onChange={setCatalogViewMode} value={catalogViewMode} />
              <CatalogSearchFilter
                activeFilterCount={testRunsView === "executions" ? activeExecutionFilterCount : 0}
                ariaLabel={testRunsView === "executions" ? "Search executions" : testRunsView === "scheduled" ? "Search schedules" : "Search operations"}
                onChange={setExecutionSearch}
                placeholder={testRunsView === "executions" ? "Search executions" : testRunsView === "scheduled" ? "Search schedules" : "Search operations"}
                subtitle={
                  testRunsView === "executions"
                    ? "Filter execution tiles by the run status and facts shown on each card."
                    : testRunsView === "scheduled"
                      ? "Filter scheduled runs by cadence, timing, or scope context."
                      : "Search titles, providers, repositories, or backup artifacts."
                }
                title={testRunsView === "executions" ? "Filter executions" : testRunsView === "scheduled" ? "Filter schedules" : "Filter operations"}
                type="search"
                value={executionSearch}
              >
                <div className="catalog-filter-grid">
                  {testRunsView === "executions" ? (
                  <label className="catalog-filter-field">
                    <span>Status</span>
                    <select
                      value={executionStatusFilter}
                      onChange={(event) => setExecutionStatusFilter(event.target.value as ExecutionStatus | "all")}
                    >
                      <option value="all">All statuses</option>
                      {executionStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {executionStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  ) : null}

                  {testRunsView === "executions" ? (
                  <label className="catalog-filter-field">
                    <span>Issue count</span>
                    <select
                      value={executionIssueFilter}
                      onChange={(event) => setExecutionIssueFilter(event.target.value as ExecutionIssueFilter)}
                    >
                      <option value="all">All runs</option>
                      <option value="with-issues">With failed or blocked cases</option>
                      <option value="clean">No failed or blocked cases</option>
                    </select>
                  </label>
                  ) : null}

                  {testRunsView === "executions" ? (
                  <label className="catalog-filter-field">
                    <span>Evidence activity</span>
                    <select
                      value={executionEvidenceFilter}
                      onChange={(event) => setExecutionEvidenceFilter(event.target.value as ExecutionEvidenceFilter)}
                    >
                      <option value="all">All runs</option>
                      <option value="with-evidence">Touched cases recorded</option>
                      <option value="no-evidence">No evidence yet</option>
                    </select>
                  </label>
                  ) : null}

                  <div className="catalog-filter-actions">
                    <button
                      className="ghost-button"
                      disabled={!activeExecutionFilterCount}
                      onClick={() => {
                        setExecutionStatusFilter("all");
                        setExecutionIssueFilter("all");
                        setExecutionEvidenceFilter("all");
                      }}
                      type="button"
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
              </CatalogSearchFilter>
            </div>

            {(testRunsView === "executions" ? executionsQuery.isLoading : testRunsView === "scheduled" ? executionSchedulesQuery.isLoading : workspaceTransactionsQuery.isLoading) ? (
              <TileCardSkeletonGrid />
            ) : null}

            {!(testRunsView === "executions" ? executionsQuery.isLoading : testRunsView === "scheduled" ? executionSchedulesQuery.isLoading : workspaceTransactionsQuery.isLoading) ? (
              <div className={catalogViewMode === "tile" ? "tile-browser-grid" : ""}>
                {testRunsView === "executions" && catalogViewMode === "tile"
                  ? filteredExecutions.map((execution) => (
                      <ExecutionListCard
                        key={execution.id}
                        execution={execution}
                        isActive={selectedExecution?.id === execution.id}
                        liveNow={liveNow}
                        onSelect={() => focusExecution(execution.id)}
                        summary={executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY}
                      />
                    ))
                  : null}
                {testRunsView === "scheduled" && catalogViewMode === "tile"
                  ? filteredSchedules.map((schedule) => (
                      <ExecutionScheduleCard
                        key={schedule.id}
                        isActive={selectedSchedule?.id === schedule.id}
                        onDelete={() => void handleDeleteExecutionSchedule(schedule.id, schedule.name)}
                        onRun={() => void handleRunExecutionSchedule(schedule.id)}
                        onSelect={() => setSelectedScheduleId(schedule.id)}
                        schedule={schedule}
                      />
                    ))
                  : null}
                {testRunsView === "operations" && catalogViewMode === "tile"
                  ? filteredWorkspaceTransactions.map((transaction) => {
                      const presentation = describeWorkspaceTransaction(transaction, {
                        appTypeNameById,
                        projectNameById
                      });
                      const summary = resolveWorkspaceTransactionSummary(transaction, presentation);
                      const scopeLabel = transaction.app_type_id
                        ? appTypeNameById[transaction.app_type_id] || "App type scope"
                        : transaction.project_id
                          ? projectNameById[transaction.project_id] || "Project scope"
                          : "Workspace scope";

                      return (
                        <button
                          className={[
                            "stack-item",
                            "execution-activity-row",
                            "execution-activity-card",
                            selectedWorkspaceTransaction?.id === transaction.id ? "is-active" : ""
                          ].filter(Boolean).join(" ")}
                          key={transaction.id}
                          onClick={() => setSelectedOperationId(transaction.id)}
                          type="button"
                        >
                          <div aria-hidden="true" className="execution-activity-icon">
                            {presentation.icon}
                          </div>
                          <div className="execution-activity-body">
                            <div className="execution-activity-head">
                              <div className="execution-activity-copy">
                                <strong>{transaction.title}</strong>
                                <span>{presentation.eyebrow}</span>
                              </div>
                              <StatusBadge value={transaction.status} />
                            </div>
                            <span className="execution-card-time">{summary}</span>
                            <div className="execution-activity-tags">
                              <span className="count-pill">{scopeLabel}</span>
                              <span className="count-pill">{formatExecutionTimestamp(transaction.latest_event_at || transaction.updated_at || transaction.created_at, "Timestamp unavailable")}</span>
                              <span className="count-pill">{`${transaction.event_count || 0} event${transaction.event_count === 1 ? "" : "s"}`}</span>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  : null}
                {testRunsView === "executions" && catalogViewMode === "list" ? (
                  <DataTable
                    columns={executionListColumns}
                    emptyMessage="No executions created yet."
                    getRowClassName={(execution) => (selectedExecution?.id === execution.id ? "is-active-row" : "")}
                    getRowKey={(execution) => execution.id}
                    onRowClick={(execution) => focusExecution(execution.id)}
                    rows={filteredExecutions}
                    storageKey="qaira:executions:list-columns"
                  />
                ) : null}
                {testRunsView === "scheduled" && catalogViewMode === "list" ? (
                  <DataTable
                    columns={executionScheduleListColumns}
                    emptyMessage="No schedules created yet."
                    getRowClassName={(schedule) => (selectedSchedule?.id === schedule.id ? "is-active-row" : "")}
                    getRowKey={(schedule) => schedule.id}
                    onRowClick={(schedule) => setSelectedScheduleId(schedule.id)}
                    rows={filteredSchedules}
                    storageKey="qaira:execution-schedules:list-columns"
                  />
                ) : null}
                {testRunsView === "operations" && catalogViewMode === "list" ? (
                  <DataTable
                    columns={operationListColumns}
                    emptyMessage="No operations have been recorded yet."
                    getRowClassName={(transaction) => (selectedWorkspaceTransaction?.id === transaction.id ? "is-active-row" : "")}
                    getRowKey={(transaction) => transaction.id}
                    onRowClick={(transaction) => setSelectedOperationId(transaction.id)}
                    rows={filteredWorkspaceTransactions}
                    storageKey="qaira:operations:list-columns"
                  />
                ) : null}
                {testRunsView === "executions" && !filteredExecutions.length ? <div className="empty-state compact">No executions created yet.</div> : null}
                {testRunsView === "scheduled" && !filteredSchedules.length ? <div className="empty-state compact">No schedules created yet.</div> : null}
                {testRunsView === "operations" && !filteredWorkspaceTransactions.length ? <div className="empty-state compact">No operations have been recorded for this scope yet.</div> : null}
              </div>
            ) : null}
          </Panel>
        )}
        detailView={(
          testRunsView === "operations" ? (
            <Panel
              className="execution-panel execution-panel--detail"
              title="Operation detail"
              subtitle={selectedWorkspaceTransaction ? "Inspect metadata, recent state, and the full event timeline for this operation." : "Select an operation from the left to inspect its trace log."}
            >
              {selectedWorkspaceTransaction ? (
                (() => {
                  const presentation = describeWorkspaceTransaction(selectedWorkspaceTransaction, {
                    appTypeNameById,
                    projectNameById
                  });
                  const summary = resolveWorkspaceTransactionSummary(selectedWorkspaceTransaction, presentation);

                  return (
                <div className="detail-stack">
                  <div className="detail-summary">
                    <strong>{selectedWorkspaceTransaction.title}</strong>
                    <span>{summary || "No summary provided for this operation."}</span>
                    <span>{selectedWorkspaceTransaction.created_user ? resolveUserPrimaryLabel(selectedWorkspaceTransaction.created_user) : "System"} · {formatExecutionTimestamp(selectedWorkspaceTransaction.created_at, "Timestamp unavailable")}</span>
                  </div>

                  <div className="metric-strip compact">
                    <div className="mini-card">
                      <strong>{selectedWorkspaceTransaction.status}</strong>
                      <span>Status</span>
                    </div>
                    <div className="mini-card">
                      <strong>{selectedWorkspaceTransaction.event_count || 0}</strong>
                      <span>Events</span>
                    </div>
                    <div className="mini-card">
                      <strong>{formatExecutionTimestamp(selectedWorkspaceTransaction.latest_event_at || selectedWorkspaceTransaction.updated_at, "Not recorded")}</strong>
                      <span>Latest activity</span>
                    </div>
                  </div>

                  <div className="stack-list">
                    <div className="stack-item">
                      <div>
                        <strong>Scope</strong>
                        <span>
                          {selectedWorkspaceTransaction.app_type_id
                            ? appTypeNameById[selectedWorkspaceTransaction.app_type_id] || "App type scope"
                            : selectedWorkspaceTransaction.project_id
                              ? projectNameById[selectedWorkspaceTransaction.project_id] || "Project scope"
                              : "Workspace scope"}
                        </span>
                      </div>
                      <StatusBadge value={selectedWorkspaceTransaction.status} />
                    </div>
                    <div className="stack-item">
                      <div>
                        <strong>Action</strong>
                        <span>{selectedWorkspaceTransaction.action.replace(/_/g, " ")}</span>
                      </div>
                    </div>
                    {Object.keys(selectedWorkspaceTransaction.metadata || {}).length ? (
                      <div className="stack-item execution-operation-metadata">
                        <div>
                          <strong>Metadata</strong>
                          <span>Operational context captured for this event.</span>
                        </div>
                        <code className="execution-operation-json">{JSON.stringify(selectedWorkspaceTransaction.metadata, null, 2)}</code>
                      </div>
                    ) : null}
                  </div>

                  <div className="execution-context-summary-head">
                    <div className="execution-context-summary-copy">
                      <strong>Trace log</strong>
                      <span>Every recorded stage for this operation appears below in the order it happened.</span>
                    </div>
                    <span className="count-pill">
                      {selectedWorkspaceTransactionEventsQuery.isLoading
                        ? "Loading…"
                        : `${(selectedWorkspaceTransactionEventsQuery.data || []).length} event${(selectedWorkspaceTransactionEventsQuery.data || []).length === 1 ? "" : "s"}`}
                    </span>
                  </div>

                  {selectedWorkspaceTransactionEventsQuery.error instanceof Error ? (
                    <div className="empty-state compact">{selectedWorkspaceTransactionEventsQuery.error.message}</div>
                  ) : null}

                  {!selectedWorkspaceTransactionEventsQuery.error && selectedWorkspaceTransactionEventsQuery.isLoading ? (
                    <div className="empty-state compact">Loading operation events…</div>
                  ) : null}

                  {!selectedWorkspaceTransactionEventsQuery.error && !(selectedWorkspaceTransactionEventsQuery.data || []).length && !selectedWorkspaceTransactionEventsQuery.isLoading ? (
                    <div className="empty-state compact">No event log has been recorded for this operation yet.</div>
                  ) : null}

                  {!selectedWorkspaceTransactionEventsQuery.error && (selectedWorkspaceTransactionEventsQuery.data || []).length ? (
                    <div className="stack-list execution-activity-list">
                      {(selectedWorkspaceTransactionEventsQuery.data || []).map((event) => (
                        <details className="stack-item execution-operation-event" key={event.id}>
                          <summary className="execution-operation-event-summary">
                            <div>
                              <strong>{event.message}</strong>
                              <span>{event.phase ? `${event.phase} · ` : ""}{formatExecutionTimestamp(event.created_at, "Timestamp unavailable")}</span>
                            </div>
                            <span className={`status-badge ${event.level}`}>{event.level}</span>
                          </summary>
                          {Object.keys(event.details || {}).length ? (
                            <code className="execution-operation-json">{JSON.stringify(event.details, null, 2)}</code>
                          ) : null}
                        </details>
                      ))}
                    </div>
                  ) : null}
                </div>
                  );
                })()
              ) : (
                <div className="empty-state compact">Choose an operation to review trace logs, counts, and provider metadata.</div>
              )}
            </Panel>
          ) : testRunsView === "scheduled" ? (
            <Panel
              className="execution-panel execution-panel--detail"
              title="Scheduled run"
              subtitle={selectedSchedule ? "Review cadence, scope, and execution context for this recurring run." : "Select a scheduled run to inspect its scope."}
            >
              {selectedSchedule ? (
                <div className="detail-stack">
                  <div className="detail-summary">
                    <strong>{selectedSchedule.name}</strong>
                    <span>{selectedSchedule.is_active ? "Active schedule" : "Inactive schedule"} · {selectedSchedule.cadence}</span>
                    <span>Next run: {formatExecutionTimestamp(selectedSchedule.next_run_at, "Not set")}</span>
                  </div>
                  <div className="metric-strip compact">
                    <div className="mini-card">
                      <strong>{selectedSchedule.suite_ids.length}</strong>
                      <span>Suites</span>
                    </div>
                    <div className="mini-card">
                      <strong>{selectedSchedule.test_case_ids.length}</strong>
                      <span>Direct cases</span>
                    </div>
                    <div className="mini-card">
                      <strong>{selectedSchedule.assigned_user ? resolveUserPrimaryLabel(selectedSchedule.assigned_user) : "Unassigned"}</strong>
                      <span>Assignee</span>
                    </div>
                  </div>
                  <div className="action-row">
                    <button className="primary-button" onClick={() => void handleRunExecutionSchedule(selectedSchedule.id)} type="button">
                      Run now
                    </button>
                    <button className="ghost-button danger" onClick={() => void handleDeleteExecutionSchedule(selectedSchedule.id, selectedSchedule.name)} type="button">
                      Delete schedule
                    </button>
                  </div>
                </div>
              ) : (
                <div className="empty-state compact">Choose a scheduled run from the left to review or launch it.</div>
              )}
            </Panel>
          ) : activeExecutionStage === "case" ? (
            <Panel
              className="execution-panel execution-panel--detail"
              actions={<WorkspaceBackButton label={`Back to ${focusedExecutionSuite?.name || "execution suites"}`} onClick={closeCaseDrilldown} />}
              title="Execution console"
              subtitle="Run the selected case, capture evidence, and inspect logs and history without the rest of the workspace crowding the screen."
            >
              {selectedExecution && selectedExecutionCase ? (
                <div className="execution-panel-body execution-panel-body--detail">
                  <div className="detail-stack">
                    <div className="execution-detail-hero">
                      <div className="execution-detail-heading">
                        <div className="execution-health-status-row">
                          <StatusBadge value={selectedCaseStatusLabel} />
                          {selectedExecutionCase.suite_name ? <span className="count-pill">{selectedExecutionCase.suite_name}</span> : null}
                          <ExecutionAssigneeChip className="execution-card-assignee--compact" user={selectedExecutionCaseEffectiveUser} />
                          <span className="execution-health-trigger">{selectedExecution?.name || "Selected execution"}</span>
                        </div>
                        <strong>{selectedExecutionCase.title}</strong>
                        <span>{selectedExecutionCase.description || "Execute this case step by step and capture evidence as you go."}</span>
                      </div>

                      <div className="execution-detail-glance">
                        <div className="execution-detail-card">
                          <span>Case duration</span>
                          <strong>{formatDuration(selectedCaseDurationMs, DEFAULT_DURATION_LABEL)}</strong>
                          <small>{selectedExecutionResult?.created_at ? `Last evidence ${formatExecutionTimestamp(selectedExecutionResult.created_at)}` : "Duration appears as the case is executed"}</small>
                        </div>
                        <div className="execution-detail-card">
                          <span>Step completion</span>
                          <strong>{selectedSteps.length ? `${selectedStepProgress.percent}%` : "0%"}</strong>
                          <small>{selectedSteps.length ? `${selectedStepProgress.passedCount + selectedStepProgress.failedCount}/${selectedSteps.length} steps resolved` : "No steps loaded for this case"}</small>
                        </div>
                        <div className="execution-detail-card">
                          <span>Evidence captured</span>
                          <strong>{resolvedEvidenceArtifactCount}</strong>
                          <small>
                            {resolvedEvidenceArtifactCount
                              ? `${resolvedStepNoteCount} note${resolvedStepNoteCount === 1 ? "" : "s"} · ${resolvedStepImageCount} image${resolvedStepImageCount === 1 ? "" : "s"}`
                              : "No evidence captured yet"}
                          </small>
                        </div>
                      </div>

                      <div className="execution-assignment-panel execution-assignment-panel--case">
                        <div className="execution-assignment-copy">
                          <strong>Case assignee</strong>
                          <span>{selectedExecutionCaseAssignmentHint}</span>
                        </div>
                        <div className="execution-assignment-actions">
                          <select
                            disabled={!assigneeOptions.length || updateExecutionCaseAssignment.isPending}
                            value={caseAssignmentDraft}
                            onChange={(event) => setCaseAssignmentDraft(event.target.value)}
                          >
                            <option value="">
                              {selectedExecution?.assigned_user
                                ? `Use execution assignee (${resolveUserPrimaryLabel(selectedExecution.assigned_user)})`
                                : assigneeOptions.length
                                  ? "Unassigned"
                                  : "No project members available"}
                            </option>
                            {assigneeOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.caption ? `${option.label} · ${option.caption}` : option.label}
                              </option>
                            ))}
                          </select>
                          <button
                            className="ghost-button"
                            disabled={!assigneeOptions.length || !hasCaseAssignmentChange || updateExecutionCaseAssignment.isPending}
                            onClick={() => void handleSaveCaseAssignment()}
                            type="button"
                          >
                            <ExecutionAssigneeIcon />
                            <span>{updateExecutionCaseAssignment.isPending ? "Saving…" : "Update assignee"}</span>
                          </button>
                          <button className="ghost-button" onClick={() => setIsExecutionContextModalOpen(true)} type="button">
                            View context snapshot
                          </button>
                          <button className="ghost-button" disabled={!selectedSteps.length} onClick={openExecutionCaseAutomationPreview} type="button">
                            <AutomationCodeIcon />
                            <span>Automation code</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <SubnavTabs
                      items={[
                        { value: "overview", label: "Overview", meta: `${selectedSteps.length} steps` },
                        { value: "logs", label: "Logs", meta: selectedExecutionResult?.status || "none" },
                        { value: "history", label: "History", meta: `${selectedCaseHistory.length}` }
                      ]}
                      onChange={setActiveTab}
                      value={activeTab}
                    />

                    {activeTab === "overview" ? (
                      <div className="detail-stack execution-overview-tab">
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

                        {!hasExecutionLevelTestData ? (
                          <div className="resource-table-shell execution-context-table-shell">
                            <div className="resource-table-toolbar">
                              <div>
                                <strong>Test case data fallback</strong>
                                <span>Using saved test case values because this execution has no attached test data set.</span>
                              </div>
                              <span className="count-pill">
                                {selectedExecutionCaseParameterEntries.length} item{selectedExecutionCaseParameterEntries.length === 1 ? "" : "s"}
                              </span>
                            </div>
                            {!selectedExecutionCaseParameterEntries.length ? (
                              <div className="empty-state compact resource-table-empty">No saved test case-level data is available for this case.</div>
                            ) : null}
                            {selectedExecutionCaseParameterEntries.length ? (
                              <div className="table-wrap execution-context-table-wrap">
                                <table className="data-table resource-data-table">
                                  <thead>
                                    <tr>
                                      <th>Key</th>
                                      <th>Value</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selectedExecutionCaseParameterEntries.map(([key, value]) => (
                                      <tr key={key}>
                                        <td>{key}</td>
                                        <td>{value || "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {!selectedSteps.length ? <div className="empty-state compact">No snapshot steps are available for this case.</div> : null}

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
                                className="ghost-button execution-steps-bulk-action"
                                disabled={!isExecutionStarted || isExecutionLocked || !bulkSelectedStepIds.length}
                                onClick={() => void handleBulkStepStatus("passed", "selected")}
                                type="button"
                              >
                                <ExecutionStepsIcon />
                                <span>Pass selected</span>
                              </button>
                              <button
                                className="ghost-button danger execution-steps-bulk-action"
                                disabled={!isExecutionStarted || isExecutionLocked || !bulkSelectedStepIds.length}
                                onClick={() => void handleBulkStepStatus("failed", "selected")}
                                type="button"
                              >
                                <ExecutionStepsIcon />
                                <span>Fail selected</span>
                              </button>
                              <button
                                className="ghost-button"
                                disabled={!isExecutionStarted || isExecutionLocked}
                                onClick={() => void handleBulkStepStatus("passed", "all")}
                                type="button"
                              >
                                <TestCaseBoardIcon />
                                <span>TC Pass</span>
                              </button>
                              <button
                                className="ghost-button danger"
                                disabled={!isExecutionStarted || isExecutionLocked}
                                onClick={() => void handleBulkStepStatus("failed", "all")}
                                type="button"
                              >
                                <TestCaseBoardIcon />
                                <span>TC Fail</span>
                              </button>
                              {executionStepGroupIds.length ? (
                                <>
                                  <button
                                    className="ghost-button execution-steps-bulk-action"
                                    disabled={expandedExecutionStepGroupIds.length === executionStepGroupIds.length}
                                    onClick={() => setExpandedExecutionStepGroupIds(executionStepGroupIds)}
                                    type="button"
                                  >
                                    <ExecutionAccordionChevronIcon />
                                    <span>Expand groups</span>
                                  </button>
                                  <button
                                    className="ghost-button execution-steps-bulk-action"
                                    disabled={!expandedExecutionStepGroupIds.length}
                                    onClick={() => setExpandedExecutionStepGroupIds([])}
                                    type="button"
                                  >
                                    <ExecutionAccordionChevronIcon />
                                    <span>Collapse groups</span>
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        ) : null}

                        <div className="execution-step-table" role="table" aria-label="Test steps for this case">
                          <div className="execution-step-table-head" role="row">
                            <span className="execution-step-col-check" role="columnheader" />
                            <span className="execution-step-col-order" role="columnheader">#</span>
                            <span className="execution-step-col-action" role="columnheader">Action</span>
                            <span className="execution-step-col-expected" role="columnheader">Expected</span>
                            <span className="execution-step-col-status" role="columnheader">Result</span>
                            <span className="execution-step-col-actions" role="columnheader">Mark</span>
                            <span className="execution-step-col-note" role="columnheader">Evidence</span>
                          </div>
                          <div className="execution-step-table-body">
                            {executionStepBlocks.map((block) => {
                              if (block.groupId) {
                                const isExpanded = expandedExecutionStepGroupIds.includes(block.groupId);

                                return (
                                  <Fragment key={block.key}>
                                    <ExecutionStepGroupRow
                                      isExpanded={isExpanded}
                                      kind={block.groupKind}
                                      name={block.groupName || "Step group"}
                                      onPreviewCode={() => openExecutionGroupAutomationPreview(block.groupName || "Step group", block.steps)}
                                      onToggle={() =>
                                        setExpandedExecutionStepGroupIds((current) =>
                                          current.includes(block.groupId as string)
                                            ? current.filter((groupId) => groupId !== block.groupId)
                                            : [...current, block.groupId as string]
                                        )
                                      }
                                      stepCount={block.steps.length}
                                    />
                                    {isExpanded
                                      ? block.steps.map((step) => {
                                          const rowStatus = stepStatuses[step.id];

                                          return (
                                            <ExecutionCompactStepRow
                                              evidence={stepEvidence[step.id] || null}
                                              isLocked={!isExecutionStarted || isExecutionLocked}
                                              isSelected={bulkSelectedStepIds.includes(step.id)}
                                              isUploadingEvidence={uploadingEvidenceStepId === step.id}
                                              key={step.id}
                                              note={stepNotes[step.id] || ""}
                                              parameterValues={executionStepParameterValues}
                                              onFail={() => void handleRecordStep(step.id, "failed")}
                                              onDeleteEvidence={() => void handleDeleteStepEvidence(step)}
                                              onNoteBlur={(value) => void handleSaveStepNote(step.id, value)}
                                              onPass={() => void handleRecordStep(step.id, "passed")}
                                              onPreviewCode={() => openExecutionStepAutomationPreview(step)}
                                              onUploadEvidence={(file) => void handleUploadStepEvidence(step, file)}
                                              onToggleSelect={(checked) =>
                                                setBulkSelectedStepIds((current) =>
                                                  checked ? [...new Set([...current, step.id])] : current.filter((id) => id !== step.id)
                                                )
                                              }
                                              onViewEvidence={() => openExecutionEvidence(step, stepEvidence[step.id] as ExecutionStepEvidence)}
                                              status={rowStatus || "queued"}
                                              step={step}
                                            />
                                          );
                                        })
                                      : null}
                                  </Fragment>
                                );
                              }

                              return block.steps.map((step) => {
                                const rowStatus = stepStatuses[step.id];

                                return (
                                  <ExecutionCompactStepRow
                                    evidence={stepEvidence[step.id] || null}
                                    isLocked={!isExecutionStarted || isExecutionLocked}
                                    isSelected={bulkSelectedStepIds.includes(step.id)}
                                    isUploadingEvidence={uploadingEvidenceStepId === step.id}
                                    key={step.id}
                                    note={stepNotes[step.id] || ""}
                                    parameterValues={executionStepParameterValues}
                                    onFail={() => void handleRecordStep(step.id, "failed")}
                                    onDeleteEvidence={() => void handleDeleteStepEvidence(step)}
                                    onNoteBlur={(value) => void handleSaveStepNote(step.id, value)}
                                    onPass={() => void handleRecordStep(step.id, "passed")}
                                    onPreviewCode={() => openExecutionStepAutomationPreview(step)}
                                    onUploadEvidence={(file) => void handleUploadStepEvidence(step, file)}
                                    onToggleSelect={(checked) =>
                                      setBulkSelectedStepIds((current) =>
                                        checked ? [...new Set([...current, step.id])] : current.filter((id) => id !== step.id)
                                      )
                                    }
                                    onViewEvidence={() => openExecutionEvidence(step, stepEvidence[step.id] as ExecutionStepEvidence)}
                                    status={rowStatus || "queued"}
                                    step={step}
                                  />
                                );
                              });
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
                              <strong>{selectedExecutionResult.test_case_title || selectedExecutionCase.title || "Selected case logs"}</strong>
                              <span>{selectedExecutionResult.error || "Structured evidence and notes for the focused case."}</span>
                            </div>
                            <ExecutionStructuredLogView
                              logsJson={selectedExecutionResult.logs}
                              onOpenEvidence={openExecutionEvidence}
                              steps={selectedSteps}
                            />
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
                                <span>{formatExecutionTimestamp(result.created_at, "Timestamp unavailable")} · {formatDuration(result.duration_ms, DEFAULT_DURATION_LABEL)}</span>
                                {result.error ? <span className="execution-log-error">{result.error}</span> : null}
                              </div>
                              <StatusBadge value={result.status} />
                            </div>
                          ))}
                        {!executionResults.length ? <div className="empty-state compact">No execution results have been logged yet.</div> : null}
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
                                <small>{formatDuration(result.duration_ms, DEFAULT_DURATION_LABEL)} · {isCurrentExecution ? "Current run" : "Switch to this execution"}</small>
                              </div>
                              <StatusBadge value={result.status} />
                            </button>
                          );
                        })}
                        {!selectedCaseHistory.length ? <div className="empty-state compact">No execution history exists yet for this selected case.</div> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="execution-panel-body execution-panel-body--detail">
                  <div className="empty-state compact">Select a case to continue.</div>
                </div>
              )}
            </Panel>
          ) : (
            <Panel
              className="execution-panel execution-panel--tree"
              actions={<WorkspaceBackButton label="Back to execution tiles" onClick={closeExecutionDrilldown} />}
              title={selectedExecution?.name || "Execution suites"}
              subtitle="Expand suite groups to review snapped test cases inline and jump straight into the execution console."
            >
              {selectedExecution ? (
                <div className="detail-stack">
                  <div className="execution-health-layout">
                    <div className="execution-health-hero">
                      <ExecutionOverviewOrb
                        blockedCount={executionStatusCounts.blocked}
                        failedCount={executionStatusCounts.failed}
                        passedCount={executionStatusCounts.passed}
                        passPercent={executionProgress.totalCases ? Math.round((executionStatusCounts.passed / executionProgress.totalCases) * 100) : 0}
                        totalCount={executionProgress.totalCases}
                      />

                      <div className="execution-health-copy">
                        <div className="execution-health-status-row">
                          <StatusBadge value={currentExecutionStatus} />
                          <span className="count-pill">{selectedExecutionAppTypeLabel}</span>
                          <ExecutionAssigneeChip className="execution-card-assignee--compact" user={selectedExecution?.assigned_user || null} />
                          <span className="execution-health-trigger">{(selectedExecution.trigger || "manual").toUpperCase()} trigger</span>
                        </div>

                        <div className="execution-health-heading">
                          <strong>{selectedExecution.name || "Unnamed execution"}</strong>
                          <span>{selectedExecutionSuiteIds.length} suites snapped into this run with {executionProgress.totalCases} cases preserved for execution evidence.</span>
                        </div>

                        <ProgressMeter
                          detail={`${executionProgress.totalCases} total · ${executionStatusCounts.passed} passed · ${executionStatusCounts.failed} failed · ${executionStatusCounts.blocked} blocked · ${remainingCaseCount} remaining`}
                          label="Run completion"
                          segments={buildProgressSegments(
                            executionStatusCounts.passed,
                            executionStatusCounts.failed,
                            executionStatusCounts.blocked,
                            executionProgress.totalCases
                          )}
                          value={executionProgress.percent}
                        />
                      </div>
                    </div>

                    <div className="metric-strip">
                      <div className="mini-card">
                        <strong>{executionProgress.totalCases}</strong>
                        <span>Total cases</span>
                      </div>
                      <div className="mini-card">
                        <strong>{formatExecutionTimestamp(selectedExecution.started_at, currentExecutionStatus === "queued" ? "Not started yet" : "Waiting to start")}</strong>
                        <span>Started</span>
                      </div>
                      <div className="mini-card">
                        <strong>{formatExecutionTimestamp(selectedExecution.ended_at, currentExecutionStatus === "running" ? "Live run" : currentExecutionStatus === "aborted" ? "Stopped before completion" : "Not finished yet")}</strong>
                        <span>Ended</span>
                      </div>
                      <div className="mini-card">
                        <strong>{formatDuration(selectedExecutionDurationMs, DEFAULT_DURATION_LABEL)}</strong>
                        <span>Run duration</span>
                      </div>
                      <div className="mini-card">
                        <strong>{blockingCases.length}</strong>
                        <span>Blocking cases</span>
                      </div>
                    </div>

                    <ExecutionContextSnapshotSummary execution={selectedExecution} onViewFull={() => setIsExecutionContextModalOpen(true)} />

                    <div className="execution-assignment-panel">
                      <div className="execution-assignment-copy">
                        <strong>Execution assignee</strong>
                        <span>Set the default owner for this run. Test cases without their own override will follow this assignee.</span>
                      </div>
                      <div className="execution-assignment-actions">
                        <select
                          disabled={!assigneeOptions.length || updateExecutionAssignment.isPending}
                          value={executionAssignmentDraft}
                          onChange={(event) => setExecutionAssignmentDraft(event.target.value)}
                        >
                          <option value="">
                            {assigneeOptions.length ? "Unassigned" : "No project members available"}
                          </option>
                          {assigneeOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.caption ? `${option.label} · ${option.caption}` : option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          className="ghost-button"
                          disabled={!assigneeOptions.length || !hasExecutionAssignmentChange || updateExecutionAssignment.isPending}
                          onClick={() => void handleSaveExecutionAssignment()}
                          type="button"
                        >
                          <ExecutionAssigneeIcon />
                          <span>{updateExecutionAssignment.isPending ? "Saving…" : "Update assignee"}</span>
                        </button>
                      </div>
                    </div>

                    <div className="execution-control-strip">
                      <div className="execution-control-copy">
                        <strong>{executionControlTitle}</strong>
                        <span>{executionControlDescription}</span>
                      </div>
                      <div className="action-row">
                        <button
                          className="ghost-button"
                          disabled={!selectedExecution || rerunExecution.isPending || startExecution.isPending || completeExecution.isPending}
                          onClick={() => void handleRerunExecution(false)}
                          type="button"
                        >
                          <ExecutionRerunIcon />
                          <span>{rerunExecution.isPending ? "Preparing…" : "Rerun execution"}</span>
                        </button>
                        <button
                          className="ghost-button"
                          disabled={!selectedExecution || !executionStatusCounts.failed || rerunExecution.isPending || startExecution.isPending || completeExecution.isPending}
                          onClick={() => void handleRerunExecution(true)}
                          type="button"
                        >
                          <ExecutionRerunIcon />
                          <span>{rerunExecution.isPending ? "Preparing…" : `Rerun failed (${executionStatusCounts.failed})`}</span>
                        </button>
                        <button
                          className="ghost-button"
                          disabled={currentExecutionStatus !== "queued" || startExecution.isPending || completeExecution.isPending}
                          onClick={() => void startExecution.mutateAsync(selectedExecution.id).then(() => refreshExecutionScope()).catch((error: Error) => showError(error, "Unable to start execution"))}
                          type="button"
                        >
                          <ExecutionStartIcon />
                          <span>{startExecution.isPending ? "Starting…" : "Start execution"}</span>
                        </button>
                        <button
                          className="ghost-button warning"
                          disabled={currentExecutionStatus !== "running" || completeExecution.isPending || startExecution.isPending}
                          onClick={() => void handleFinalizeExecution("abort")}
                          type="button"
                        >
                          <ExecutionAbortIcon />
                          <span>{completeExecution.isPending && executionFinalizeAction === "abort" ? "Aborting…" : "Abort execution"}</span>
                        </button>
                        <button
                          className="ghost-button"
                          disabled={currentExecutionStatus !== "running" || completeExecution.isPending || startExecution.isPending}
                          onClick={() => void handleFinalizeExecution("complete")}
                          type="button"
                        >
                          <ExecutionCompleteIcon />
                          <span>{completeExecution.isPending && executionFinalizeAction === "complete" ? "Completing…" : "Complete execution"}</span>
                        </button>
                      </div>
                    </div>

                    <div className="suite-tree">
                      {executionSuites.map((suite) => {
                        const suiteCases = displayCasesBySuiteId[suite.id] || [];
                        const suiteMetric = suiteMetrics.find((item) => item.suiteId === suite.id);
                        const suiteStatus = suiteMetric ? suiteBoardStatus(suiteMetric) : "queued";
                        const suiteResolvedCount =
                          (suiteMetric?.passedCount || 0) +
                          (suiteMetric?.failedCount || 0) +
                          (suiteMetric?.blockedCount || 0);
                        const isExpanded = expandedExecutionSuiteIds.includes(suite.id);
                        const isFocusedSuite = focusedSuiteId === suite.id;

                        return (
                          <div className={["tree-suite", isExpanded ? "is-expanded" : ""].filter(Boolean).join(" ")} key={suite.id}>
                            <div
                              className={[
                                "record-card tile-card execution-suite-card",
                                isFocusedSuite ? "is-active" : "",
                                isExpanded ? "is-expanded" : ""
                              ].filter(Boolean).join(" ")}
                            >
                              <div className="tree-suite-row">
                                <button
                                  aria-expanded={isExpanded}
                                  className="tree-suite-expand"
                                  onClick={() => toggleSuiteGroup(suite.id)}
                                  type="button"
                                >
                                  <div className="tile-card-main">
                                    <div className="tile-card-header">
                                      <div className="execution-suite-card-actions">
                                        <span aria-hidden="true" className={isExpanded ? "tree-suite-chevron is-expanded" : "tree-suite-chevron"}>
                                          <ExecutionAccordionChevronIcon />
                                        </span>
                                        <div
                                          aria-hidden="true"
                                          className={`record-card-icon execution-board-icon status-${suiteStatus}`}
                                          title={boardStatusTooltip(suiteStatus)}
                                        >
                                          <ExecutionSuiteIcon />
                                        </div>
                                      </div>
                                      <div className="tile-card-title-group">
                                        <strong>{suite.name}</strong>
                                        <span className="tile-card-kicker">{suiteResolvedCount}/{suiteMetric?.count || 0} resolved</span>
                                      </div>
                                      <ExecutionStatusIndicator status={suiteStatus} />
                                    </div>

                                    <div className="execution-card-facts" aria-label={`${suite.name} facts`}>
                                      <ExecutionCardFact
                                        ariaLabel={`${suiteCases.length} cases in suite`}
                                        label={String(suiteCases.length)}
                                        title={`${suiteCases.length} cases in suite`}
                                      >
                                        <ExecutionScopeIcon />
                                      </ExecutionCardFact>
                                      <ExecutionCardFact
                                        ariaLabel={`${suiteResolvedCount} of ${suiteMetric?.count || 0} cases resolved`}
                                        label={`${suiteResolvedCount}/${suiteMetric?.count || 0}`}
                                        title={`${suiteResolvedCount}/${suiteMetric?.count || 0} cases resolved`}
                                      >
                                        <ExecutionProgressFactsIcon />
                                      </ExecutionCardFact>
                                      <ExecutionCardFact
                                        ariaLabel={`${(suiteMetric?.failedCount || 0) + (suiteMetric?.blockedCount || 0)} failing or blocked cases`}
                                        label={String((suiteMetric?.failedCount || 0) + (suiteMetric?.blockedCount || 0))}
                                        title={`${suiteMetric?.failedCount || 0} failed · ${suiteMetric?.blockedCount || 0} blocked`}
                                        tone={suiteMetric?.failedCount ? "danger" : suiteMetric?.blockedCount ? "warning" : "success"}
                                      >
                                        <ExecutionRiskIcon />
                                      </ExecutionCardFact>
                                      <ExecutionCardFact
                                        ariaLabel={`Suite duration ${formatDuration(suiteDurationById[suite.id], DEFAULT_DURATION_LABEL)}`}
                                        label={formatDuration(suiteDurationById[suite.id], DEFAULT_DURATION_LABEL)}
                                        title={`Total recorded suite duration ${formatDuration(suiteDurationById[suite.id], DEFAULT_DURATION_LABEL)}`}
                                        tone={suiteStatus === "blocked" ? "warning" : "neutral"}
                                      >
                                        <ExecutionTimeIcon />
                                      </ExecutionCardFact>
                                    </div>

                                    <ProgressMeter
                                      detail={`${suiteMetric?.passedCount || 0} passed · ${suiteMetric?.failedCount || 0} failed · ${suiteMetric?.blockedCount || 0} blocked`}
                                      hideCopy
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

                                {isExpanded ? (
                                  <div className="tree-suite-body">
                                    <div className="tree-suite-bulk-actions">
                                      <button
                                        className="ghost-button suite-bulk-pass"
                                        disabled={!isExecutionStarted || isExecutionLocked}
                                        onClick={() => void handleSuiteBulkStatus(suite.id, "passed")}
                                        type="button"
                                      >
                                        <ExecutionSuiteIcon />
                                        <span>Suite Pass</span>
                                      </button>
                                      <button
                                        className="ghost-button danger suite-bulk-fail"
                                        disabled={!isExecutionStarted || isExecutionLocked}
                                        onClick={() => void handleSuiteBulkStatus(suite.id, "failed")}
                                        type="button"
                                      >
                                        <ExecutionSuiteIcon />
                                        <span>Suite Fail</span>
                                      </button>
                                    </div>

                                    <div className="tree-children">
                                      {suiteCases.map((testCase) => (
                                        <ExecutionSuiteCaseCard
                                          assignedUser={testCase.assigned_user || selectedExecution?.assigned_user || null}
                                          caseStatus={caseDerivedStatus(testCase)}
                                          durationLabel={formatDuration(resolveCaseDurationMs(testCase.id, resultByCaseId[testCase.id]), DEFAULT_DURATION_LABEL)}
                                          isActive={selectedTestCaseId === testCase.id}
                                          isNext={nextFocusCase?.id === testCase.id}
                                          key={testCase.id}
                                          onSelect={() => focusExecutionCase(testCase.id)}
                                          stepCount={(stepsByCaseId[testCase.id] || []).length}
                                          suiteName={suite.name}
                                          testCase={testCase}
                                        />
                                      ))}
                                      {!suiteCases.length ? <div className="empty-state compact">No test cases were snapped into this suite.</div> : null}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {!executionSuites.length ? <div className="empty-state compact">No suites were selected for this execution.</div> : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-state compact">Select an execution to inspect its snapshot scope.</div>
              )}
            </Panel>
          )
        )}
        isDetailOpen={
          testRunsView === "scheduled"
            ? Boolean(selectedSchedule)
            : testRunsView === "operations"
              ? Boolean(selectedWorkspaceTransaction)
              : Boolean(selectedExecution)
        }
      />

      {executionEvidencePreview ? (
        <div className="modal-backdrop" onClick={() => setExecutionEvidencePreview(null)} role="presentation">
          <div
            aria-labelledby="execution-evidence-modal-title"
            aria-modal="true"
            className="modal-card execution-evidence-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="execution-evidence-modal-header">
              <div className="execution-evidence-modal-copy">
                <p className="eyebrow">Execution Evidence</p>
                <h3 id="execution-evidence-modal-title">{executionEvidencePreview.fileName || "Evidence image"}</h3>
                <p>{executionEvidencePreview.stepLabel}</p>
              </div>
              <button className="ghost-button" onClick={() => setExecutionEvidencePreview(null)} type="button">
                Close
              </button>
            </div>
            <div className="execution-evidence-modal-body">
              <img
                alt={`${executionEvidencePreview.stepLabel} evidence`}
                className="execution-evidence-modal-image"
                src={executionEvidencePreview.dataUrl}
              />
            </div>
          </div>
        </div>
      ) : null}

      {codePreviewState ? (
        <CodePreviewDialog
          code={codePreviewState.code}
          onClose={() => setCodePreviewState(null)}
          subtitle={codePreviewState.subtitle}
          title={codePreviewState.title}
        />
      ) : null}

      {selectedExecution && isExecutionContextModalOpen ? (
        <ExecutionContextSnapshotModal execution={selectedExecution} onClose={() => setIsExecutionContextModalOpen(false)} />
      ) : null}

      {isCreateExecutionModalOpen ? (
        <ExecutionCreateModal
          appTypeId={appTypeId}
          appTypes={appTypes}
          assigneeOptions={assigneeOptions}
          canCreateExecution={canCreateExecution}
          executionCreateMode={executionCreateMode}
          executionName={executionName}
          integrations={integrations}
          isPreviewingSmartExecution={previewSmartExecution.isPending}
          isSubmitting={createExecution.isPending}
          onAssigneeChange={setSelectedExecutionAssigneeId}
          onConfigurationChange={handleExecutionConfigurationChange}
          onDataSetChange={handleExecutionDataSetChange}
          onEnvironmentChange={handleExecutionEnvironmentChange}
          onAppTypeChange={handleExecutionAppTypeChange}
          onClose={closeExecutionBuilder}
          onExecutionCreateModeChange={setExecutionCreateMode}
          onExecutionNameChange={setExecutionName}
          onPreviewSmartExecution={() => void handlePreviewSmartExecution()}
          onProjectChange={handleExecutionProjectChange}
          onSuiteSelectionChange={setSelectedSuiteIds}
          onSelectAllSmartExecutionCases={() => setSelectedSmartExecutionCaseIds(smartPreviewCases.map((testCase) => testCase.test_case_id))}
          onClearSmartExecutionCases={() => setSelectedSmartExecutionCaseIds([])}
          onClearSmartExecutionRequirements={handleClearSmartExecutionRequirements}
          onSmartExecutionAdditionalContextChange={handleSmartExecutionAdditionalContextChange}
          onSmartExecutionIntegrationChange={handleSmartExecutionIntegrationChange}
          onSmartExecutionRequirementSearchChange={setSmartExecutionRequirementSearch}
          onSmartExecutionReleaseScopeChange={handleSmartExecutionReleaseScopeChange}
          onSelectAllSmartExecutionRequirements={(requirementIds) => handleSelectSmartExecutionRequirements(requirementIds)}
          onSubmit={(event) => void handleCreateExecution(event)}
          onToggleSmartExecutionRequirement={handleToggleSmartExecutionRequirement}
          onToggleSmartExecutionCase={(testCaseId) =>
            setSelectedSmartExecutionCaseIds((current) =>
              current.includes(testCaseId) ? current.filter((id) => id !== testCaseId) : [...current, testCaseId]
            )
          }
          projectId={projectId}
          projects={projects}
          selectedConfigurationId={selectedExecutionConfigurationId}
          selectedExecutionAssigneeId={selectedExecutionAssigneeId}
          scopeSuites={scopeSuites}
          selectedAppType={selectedAppType?.name || ""}
          selectedDataSetId={selectedExecutionDataSetId}
          selectedEnvironmentId={selectedExecutionEnvironmentId}
          selectedProject={selectedProject?.name || ""}
          selectedSuiteIds={selectedSuiteIds}
          selectedSmartExecutionCaseIds={selectedSmartExecutionCaseIds}
          smartExecutionAdditionalContext={smartExecutionAdditionalContext}
          smartExecutionIntegrationId={smartExecutionIntegrationId}
          smartExecutionPreview={smartExecutionPreview}
          smartExecutionPreviewMessage={smartExecutionPreviewMessage}
          smartExecutionPreviewTone={smartExecutionPreviewTone}
          smartExecutionRequirementOptions={smartExecutionRequirementOptions}
          smartExecutionRequirementSearch={smartExecutionRequirementSearch}
          smartExecutionReleaseScope={smartExecutionReleaseScope}
          selectedSmartRequirementIds={selectedSmartRequirementIds}
        />
      ) : null}

      {isCreateScheduleModalOpen ? (
        <CreateExecutionScheduleModal
          appTypeId={appTypeId}
          appTypeName={selectedAppType?.name || ""}
          assigneeOptions={assigneeOptions}
          cadence={scheduleCadence}
          executionName={executionName}
          isSubmitting={createExecutionSchedule.isPending}
          nextRunAt={scheduleNextRunAt}
          onAssigneeChange={setSelectedExecutionAssigneeId}
          onCadenceChange={setScheduleCadence}
          onClose={closeScheduleBuilder}
          onConfigurationChange={setSelectedExecutionConfigurationId}
          onDataSetChange={setSelectedExecutionDataSetId}
          onEnvironmentChange={setSelectedExecutionEnvironmentId}
          onExecutionNameChange={setExecutionName}
          onNextRunAtChange={setScheduleNextRunAt}
          onSubmit={(event) => void handleCreateExecutionSchedule(event)}
          onSuiteSelectionChange={setSelectedSuiteIds}
          projectId={projectId}
          projectName={selectedProject?.name || ""}
          scopeSuites={scopeSuites}
          selectedAssigneeId={selectedExecutionAssigneeId}
          selectedConfigurationId={selectedExecutionConfigurationId}
          selectedDataSetId={selectedExecutionDataSetId}
          selectedEnvironmentId={selectedExecutionEnvironmentId}
          selectedSuiteIds={selectedSuiteIds}
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

function ExecutionAssigneeChip({
  user,
  className = "",
  fallback = "Unassigned"
}: {
  user?: { name?: string | null; email?: string | null } | null;
  className?: string;
  fallback?: string;
}) {
  const label = user ? resolveUserPrimaryLabel(user) : fallback;
  const detail = user ? resolveUserSecondaryLabel(user) : null;

  return (
    <span className={["execution-card-assignee", className].filter(Boolean).join(" ")} title={detail || label}>
      <span className="execution-card-assignee-avatar" aria-hidden="true">
        {resolveUserInitials(user)}
      </span>
      <span>{label}</span>
    </span>
  );
}

function ExecutionListCard({
  execution,
  summary,
  liveNow,
  isActive,
  onSelect
}: {
  execution: Execution;
  summary: ExecutionRunSummary;
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
    DEFAULT_DURATION_LABEL
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
            <ExecutionAssigneeChip user={execution.assigned_user} />
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

function ExecutionScheduleCard({
  schedule,
  isActive,
  onSelect,
  onRun,
  onDelete
}: {
  schedule: ExecutionSchedule;
  isActive: boolean;
  onSelect: () => void;
  onRun: () => void;
  onDelete: () => void;
}) {
  const nextRunLabel = formatExecutionTimestamp(schedule.next_run_at, "Not scheduled");
  const assigneeLabel = schedule.assigned_user ? resolveUserPrimaryLabel(schedule.assigned_user) : "Unassigned";

  return (
    <div className={isActive ? "record-card tile-card execution-card virtual-card is-active" : "record-card tile-card execution-card virtual-card"}>
      <button className="tile-card-main execution-schedule-card-button" onClick={onSelect} type="button">
        <div className="tile-card-header">
          <div aria-hidden="true" className={`record-card-icon execution status-${schedule.is_active ? "queued" : "aborted"}`}>
            <ExecutionScheduleIcon />
          </div>
          <div className="tile-card-title-group">
            <strong>{schedule.name}</strong>
            <span className="execution-card-assignee">{schedule.is_active ? `${schedule.cadence} cadence` : "Inactive schedule"}</span>
          </div>
          <ExecutionStatusIndicator status={schedule.is_active ? "queued" : "aborted"} />
        </div>

        <div className="execution-card-facts" aria-label="Schedule facts">
          <ExecutionCardFact ariaLabel={`${schedule.suite_ids.length} suites in scope`} label={String(schedule.suite_ids.length)} title={`${schedule.suite_ids.length} suites in scope`}>
            <ExecutionSuiteIcon />
          </ExecutionCardFact>
          <ExecutionCardFact ariaLabel={`${schedule.test_case_ids.length} direct cases in scope`} label={String(schedule.test_case_ids.length)} title={`${schedule.test_case_ids.length} direct cases in scope`}>
            <ExecutionScopeIcon />
          </ExecutionCardFact>
          <ExecutionCardFact ariaLabel={`Assigned to ${assigneeLabel}`} label={assigneeLabel} title={`Assigned to ${assigneeLabel}`}>
            <ExecutionAssigneeIcon />
          </ExecutionCardFact>
          <ExecutionCardFact ariaLabel={`Next run ${nextRunLabel}`} label={nextRunLabel} title={`Next run ${nextRunLabel}`}>
            <ExecutionTimeIcon />
          </ExecutionCardFact>
        </div>
      </button>

      <div className="action-row execution-schedule-actions">
        <button className="ghost-button" onClick={onRun} type="button">
          <ExecutionStartIcon />
          <span>Run now</span>
        </button>
        <button className="ghost-button danger" onClick={onDelete} type="button">
          <ExecutionDeleteIcon />
          <span>Delete</span>
        </button>
      </div>
    </div>
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

function ExecutionStatusIndicator({ status }: { status: BoardStatusTone }) {
  const tooltip = boardStatusTooltip(status);

  return (
    <span aria-label={tooltip} className={`execution-card-status status-${status}`} title={tooltip}>
      <ExecutionStatusIcon status={status} />
    </span>
  );
}

function ExecutionStatusIcon({ status }: { status: BoardStatusTone }) {
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

  if (status === "completed" || status === "passed") {
    return (
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
        <path d="M6 12.5 10 16l8-8" />
      </svg>
    );
  }

  if (status === "blocked") {
    return (
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
        <circle cx="12" cy="12" r="8" />
        <path d="M8 12h8" />
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

function ExecutionStartIcon() {
  return (
    <ExecutionIconShell>
      <path d="m9 7 8 5-8 5z" />
    </ExecutionIconShell>
  );
}

function ExecutionCompleteIcon() {
  return (
    <ExecutionIconShell>
      <path d="M6 12.5 10 16l8-8" />
    </ExecutionIconShell>
  );
}

function ExecutionAbortIcon() {
  return (
    <ExecutionIconShell>
      <circle cx="12" cy="12" r="8" />
      <rect height="5" rx="0.8" width="5" x="9.5" y="9.5" />
    </ExecutionIconShell>
  );
}

function ExecutionRerunIcon() {
  return (
    <ExecutionIconShell>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v6h-6" />
    </ExecutionIconShell>
  );
}

function ExecutionScheduleIcon() {
  return (
    <ExecutionIconShell>
      <rect height="15" rx="2" width="16" x="4" y="5" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M4 10h16" />
      <path d="m10 15 1.5 1.5L15 13" />
    </ExecutionIconShell>
  );
}

function ExecutionAssigneeIcon() {
  return (
    <ExecutionIconShell>
      <path d="M4 20v-1.2A4.8 4.8 0 0 1 8.8 14h6.4a4.8 4.8 0 0 1 4.8 4.8V20" />
      <circle cx="12" cy="8.2" r="3.2" />
    </ExecutionIconShell>
  );
}

function ExecutionDeleteIcon() {
  return (
    <ExecutionIconShell>
      <path d="M4 7h16" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M7 7l.8 11.1A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.9L17 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </ExecutionIconShell>
  );
}

function ExecutionIconShell({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">{children}</svg>;
}

function TestCaseBoardIcon() {
  return (
    <ExecutionIconShell>
      <rect height="14" rx="2" width="14" x="5" y="5" />
      <path d="M9 10h6" />
      <path d="M9 14h6" />
    </ExecutionIconShell>
  );
}

function ExecutionSuiteIcon() {
  return (
    <ExecutionIconShell>
      <path d="m12 4 8 4-8 4-8-4Z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </ExecutionIconShell>
  );
}

function ExecutionScopeIcon() {
  return (
    <TestCaseBoardIcon />
  );
}

function ExecutionProgressFactsIcon() {
  return (
    <ExecutionIconShell>
      <path d="M4 16h16" />
      <path d="M7 13 10 10l3 2 4-5" />
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

function ExecutionPriorityIcon() {
  return (
    <ExecutionIconShell>
      <path d="M7 20V5" />
      <path d="M7 5h10l-2 4 2 4H7" />
    </ExecutionIconShell>
  );
}

function ExecutionStepsIcon() {
  return (
    <ExecutionIconShell>
      <path d="M8 7h10" />
      <path d="M8 12h10" />
      <path d="M8 17h10" />
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
    </ExecutionIconShell>
  );
}

function StepKindIconBadge({
  label,
  tone: _tone
}: {
  label: string;
  tone: "default" | "shared" | "local";
}) {
  return (
    <span
      aria-label={label}
      className="step-kind-badge is-standard"
      title={label}
    >
      <StandardStepIcon />
    </span>
  );
}

function ExecutionStepPassIcon() {
  return (
    <ExecutionIconShell>
      <path d="m7.5 12.5 3 3 6-7" />
    </ExecutionIconShell>
  );
}

function ExecutionStepFailIcon() {
  return (
    <ExecutionIconShell>
      <path d="m8 8 8 8" />
      <path d="m16 8-8 8" />
    </ExecutionIconShell>
  );
}

function ExecutionEvidenceImageIcon() {
  return (
    <ExecutionIconShell>
      <rect height="14" rx="2" width="16" x="4" y="5" />
      <circle cx="9" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <path d="m7 17 3-3 2.5 2.5 2.5-3 2 3.5" />
    </ExecutionIconShell>
  );
}

function ExecutionEvidencePreviewIcon() {
  return (
    <ExecutionIconShell>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </ExecutionIconShell>
  );
}

function ExecutionEvidenceDeleteIcon() {
  return (
    <ExecutionIconShell>
      <path d="M4 7h16" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M7 7l.8 11.1A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.9L17 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </ExecutionIconShell>
  );
}

function ExecutionOverviewOrb({
  passedCount,
  failedCount,
  blockedCount,
  totalCount,
  passPercent
}: {
  passedCount: number;
  failedCount: number;
  blockedCount: number;
  totalCount: number;
  passPercent: number;
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
          <strong>{passPercent}%</strong>
          <span>Pass rate</span>
        </div>
      </div>
      <div className="execution-overview-legend">
        <span className="execution-legend-item tone-total">{totalCount} total</span>
        <span className="execution-legend-item tone-passed">{passedCount} passed</span>
        <span className="execution-legend-item tone-failed">{failedCount} failed</span>
        <span className="execution-legend-item tone-blocked">{blockedCount} blocked</span>
        <span className="execution-legend-item tone-pending">{pendingCount} queued</span>
      </div>
    </div>
  );
}

function ExecutionSuiteCaseCard({
  testCase,
  suiteName,
  stepCount,
  durationLabel,
  caseStatus,
  assignedUser,
  isActive,
  isNext,
  onSelect
}: {
  testCase: ExecutionCaseView;
  suiteName: string;
  stepCount: number;
  durationLabel: string;
  caseStatus: ExecutionResult["status"] | "queued";
  assignedUser?: Execution["assigned_user"];
  isActive: boolean;
  isNext: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={[
        "record-card tile-card test-case-card execution-case-card execution-board-case-card",
        isActive ? "is-active" : "",
        !isActive && isNext ? "is-next" : ""
      ].filter(Boolean).join(" ")}
      onClick={onSelect}
      type="button"
    >
      <div className="tile-card-main">
        <div className="tile-card-header">
          <div
            aria-hidden="true"
            className={`record-card-icon execution-board-icon status-${caseStatus}`}
            title={boardStatusTooltip(caseStatus)}
          >
            <TestCaseBoardIcon />
          </div>
          <div className="tile-card-title-group">
            <strong>{testCase.title}</strong>
            <div className="execution-case-card-meta">
              <span className="tile-card-kicker">{isNext ? "Next recommended case" : suiteName || "Suite case"}</span>
              <ExecutionAssigneeChip className="execution-card-assignee--compact" user={assignedUser} />
            </div>
          </div>
          <ExecutionStatusIndicator status={caseStatus} />
        </div>
        <div className="execution-card-facts" aria-label={`${testCase.title} facts`}>
          <ExecutionCardFact
            ariaLabel={`Priority P${testCase.priority || 3}`}
            label={`P${testCase.priority || 3}`}
            title={`Priority P${testCase.priority || 3}`}
          >
            <ExecutionPriorityIcon />
          </ExecutionCardFact>
          <ExecutionCardFact
            ariaLabel={`${stepCount} steps`}
            label={String(stepCount)}
            title={`${stepCount} steps`}
          >
            <ExecutionStepsIcon />
          </ExecutionCardFact>
          <ExecutionCardFact
            ariaLabel={`Case duration ${durationLabel}`}
            label={durationLabel}
            title={`Case duration ${durationLabel}`}
            tone={caseStatus === "blocked" ? "warning" : "neutral"}
          >
            <ExecutionTimeIcon />
          </ExecutionCardFact>
        </div>
      </div>
    </button>
  );
}

function ExecutionStepGroupRow({
  name,
  kind,
  isExpanded,
  stepCount,
  onPreviewCode,
  onToggle
}: {
  name: string;
  kind: TestStep["group_kind"];
  isExpanded: boolean;
  stepCount: number;
  onPreviewCode: () => void;
  onToggle: () => void;
}) {
  const stepKind = getExecutionStepKindMeta(kind || "local");

  return (
    <div className={["execution-step-group-row", kind === "reusable" ? "is-shared-group" : "is-local-group"].join(" ")} role="row">
      <div className="execution-step-group-toggle-button">
        <button
          aria-expanded={isExpanded}
          className="execution-step-group-button-main"
          onClick={onToggle}
          type="button"
        >
          <span className="execution-step-group-label" role="cell">
            <span className="execution-step-group-label-main">
              <span className="execution-step-group-toggle">
                <span aria-hidden="true" className={isExpanded ? "execution-step-group-chevron is-expanded" : "execution-step-group-chevron"}>
                  <ExecutionAccordionChevronIcon />
                </span>
                <span aria-hidden="true" className={kind === "reusable" ? "step-group-icon is-shared" : "step-group-icon is-local"}>
                  <SharedGroupLevelIcon kind={kind} />
                </span>
                <strong>{name}</strong>
              </span>
            </span>
            <span>{stepKind.detail} · {isExpanded ? "Expanded" : "Collapsed"}</span>
          </span>
        </button>
        <span className="execution-step-group-meta" role="cell">
          <span className="execution-step-group-count">{stepCount} step{stepCount === 1 ? "" : "s"}</span>
          <button
            aria-label={`Preview automation for ${name}`}
            className="step-inline-tool is-active"
            onClick={onPreviewCode}
            title="Preview group automation"
            type="button"
          >
            <AutomationCodeIcon />
          </button>
        </span>
      </div>
    </div>
  );
}

function ExecutionCompactStepRow({
  step,
  status,
  note,
  evidence,
  parameterValues,
  isLocked,
  isSelected,
  isUploadingEvidence,
  onToggleSelect,
  onPass,
  onFail,
  onDeleteEvidence,
  onNoteBlur,
  onUploadEvidence,
  onViewEvidence,
  onPreviewCode
}: {
  step: TestStep;
  status: ExecutionResult["status"] | "queued";
  note: string;
  evidence: ExecutionStepEvidence | null;
  parameterValues: Record<string, string>;
  isLocked: boolean;
  isSelected: boolean;
  isUploadingEvidence: boolean;
  onToggleSelect: (checked: boolean) => void;
  onPass: () => void;
  onFail: () => void;
  onDeleteEvidence: () => void;
  onNoteBlur: (value: string) => void;
  onUploadEvidence: (file: File) => void;
  onViewEvidence: () => void;
  onPreviewCode: () => void;
}) {
  const evidenceInputRef = useRef<HTMLInputElement | null>(null);
  const resolvedKind = step.group_name ? step.group_kind || "local" : step.group_kind;
  const stepKind = getExecutionStepKindMeta(resolvedKind);
  const resolvedExpectedResult = resolveStepParameterText(step.expected_result, parameterValues);
  const toneClass = [
    "execution-step-row",
    status === "passed" ? "is-passed" : "",
    status === "failed" ? "is-failed" : "",
    stepKind.tone === "shared" ? "is-shared-step" : "",
    stepKind.tone === "local" ? "is-local-step" : ""
  ].filter(Boolean).join(" ");

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
      <div className="execution-step-col-action execution-step-copy" role="cell">
        <div className="execution-step-badges">
          <StepKindIconBadge label="Standard step" tone={stepKind.tone} />
          <span className="execution-step-type-chip" title={`Step type: ${String(step.step_type || "web").toUpperCase()}`}>
            <StepTypeIcon size={14} type={step.step_type} />
          </span>
          <InlineStepToolButton
            ariaLabel={`Preview automation for step ${step.step_order}`}
            className="is-active"
            onClick={onPreviewCode}
            title="Preview step automation"
          >
            <AutomationCodeIcon />
          </InlineStepToolButton>
        </div>
        <StepParameterizedText
          className="execution-step-clamp"
          fallback="—"
          text={step.action}
          values={parameterValues}
        />
      </div>
      <span className="execution-step-col-expected execution-step-clamp" role="cell" title={resolvedExpectedResult || step.expected_result || ""}>
        <StepParameterizedText
          className="execution-step-clamp"
          fallback="—"
          text={step.expected_result}
          values={parameterValues}
        />
      </span>
      <span className="execution-step-col-status" role="cell">
        <StatusBadge value={status} />
      </span>
      <span className="execution-step-col-actions" role="cell">
        <div className="execution-step-mark-buttons">
          <button
            aria-label={`Mark step ${step.step_order} as passed`}
            className="execution-step-action-button execution-step-pass"
            disabled={isLocked}
            onClick={onPass}
            title="Mark passed"
            type="button"
          >
            <ExecutionStepPassIcon />
          </button>
          <button
            aria-label={`Mark step ${step.step_order} as failed`}
            className="execution-step-action-button execution-step-fail"
            disabled={isLocked}
            onClick={onFail}
            title="Mark failed"
            type="button"
          >
            <ExecutionStepFailIcon />
          </button>
        </div>
      </span>
      <div className="execution-step-col-note" role="cell">
        <div className="execution-step-evidence-cell">
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
          <input
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";

              if (file) {
                onUploadEvidence(file);
              }
            }}
            ref={evidenceInputRef}
            type="file"
          />
          <div className="execution-step-evidence-actions">
            <button
              className="execution-step-evidence-button"
              disabled={isLocked || isUploadingEvidence}
              onClick={() => evidenceInputRef.current?.click()}
              title={evidence ? "Replace evidence image" : "Upload evidence image"}
              type="button"
            >
              <ExecutionEvidenceImageIcon />
              <span>{isUploadingEvidence ? "Uploading…" : evidence ? "Replace image" : "Upload image"}</span>
            </button>
            {evidence ? (
              <>
                <button
                  className="execution-step-evidence-link"
                  disabled={isUploadingEvidence}
                  onClick={onViewEvidence}
                  title={evidence.fileName || "View saved evidence image"}
                  type="button"
                >
                  <ExecutionEvidencePreviewIcon />
                  <span>{evidence.fileName || "View image"}</span>
                </button>
                <button
                  className="execution-step-evidence-delete"
                  disabled={isLocked || isUploadingEvidence}
                  onClick={onDeleteEvidence}
                  title="Delete saved evidence image"
                  type="button"
                >
                  <ExecutionEvidenceDeleteIcon />
                  <span>Delete image</span>
                </button>
              </>
            ) : (
              <span className="execution-step-evidence-empty">No image uploaded</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExecutionStructuredLogView({
  logsJson,
  steps,
  onOpenEvidence
}: {
  logsJson: string | null;
  steps: TestStep[];
  onOpenEvidence?: (step: TestStep, evidence: ExecutionStepEvidence) => void;
}) {
  const parsed = parseExecutionLogs(logsJson);
  const hasNotes = parsed.stepNotes && Object.keys(parsed.stepNotes).length > 0;
  const hasStatuses = parsed.stepStatuses && Object.keys(parsed.stepStatuses).length > 0;
  const hasEvidence = parsed.stepEvidence && Object.keys(parsed.stepEvidence).length > 0;

  if (!hasNotes && !hasStatuses && !hasEvidence && !logsJson?.trim()) {
    return <span className="execution-log-empty">No structured step data recorded yet.</span>;
  }

  const rows = steps
    .map((step, index) => {
      const st = parsed.stepStatuses?.[step.id];
      const nt = parsed.stepNotes?.[step.id];
      const evidence = parsed.stepEvidence?.[step.id];

      if (!st && !nt && !evidence) {
        if (!isStepGroupStart(steps, index)) {
          return null;
        }
      }
      return (
        <Fragment key={step.id}>
          {isStepGroupStart(steps, index) ? (
            <div className="execution-structured-log-row execution-structured-log-row--group">
              <strong>{step.group_name || "Step group"}</strong>
              <span aria-hidden="true" className={step.group_kind === "reusable" ? "step-group-icon is-shared" : "step-group-icon is-local"}>
                <SharedGroupLevelIcon kind={step.group_kind} />
              </span>
              <span className="execution-structured-note">
                {step.group_kind === "reusable" ? "Shared group snapshot" : "Local group snapshot"}
              </span>
            </div>
          ) : null}
          {st || nt || evidence ? (
            <div className="execution-structured-log-row">
              <strong>Step {step.step_order}</strong>
              {st ? <StatusBadge value={st} /> : null}
              {evidence ? (
                <button
                  className="execution-structured-evidence-button"
                  onClick={() => evidence && onOpenEvidence?.(step, evidence)}
                  type="button"
                >
                  <ExecutionEvidencePreviewIcon />
                  <span>{evidence.fileName || "View image evidence"}</span>
                </button>
              ) : null}
              {nt ? <span className="execution-structured-note">{nt}</span> : null}
            </div>
          ) : null}
        </Fragment>
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
  const evidenceCount = parsed.stepEvidence ? Object.keys(parsed.stepEvidence).length : 0;
  if (!noteCount && !statusCount && !evidenceCount) {
    return <span className="execution-log-summary-muted">No step details</span>;
  }
  return (
    <span className="execution-log-summary">
      {statusCount ? `${statusCount} step result${statusCount === 1 ? "" : "s"}` : null}
      {statusCount && (noteCount || evidenceCount) ? " · " : null}
      {noteCount ? `${noteCount} note${noteCount === 1 ? "" : "s"}` : null}
      {noteCount && evidenceCount ? " · " : null}
      {evidenceCount ? `${evidenceCount} image${evidenceCount === 1 ? "" : "s"}` : null}
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
  executionCreateMode,
  onExecutionCreateModeChange,
  selectedProject,
  selectedAppType,
  scopeSuites,
  selectedSuiteIds,
  executionName,
  selectedEnvironmentId,
  selectedConfigurationId,
  selectedDataSetId,
  selectedExecutionAssigneeId,
  assigneeOptions,
  integrations,
  smartExecutionIntegrationId,
  smartExecutionReleaseScope,
  smartExecutionAdditionalContext,
  smartExecutionRequirementOptions,
  smartExecutionRequirementSearch,
  smartExecutionPreview,
  selectedSmartRequirementIds,
  selectedSmartExecutionCaseIds,
  smartExecutionPreviewMessage,
  smartExecutionPreviewTone,
  onExecutionNameChange,
  onEnvironmentChange,
  onConfigurationChange,
  onDataSetChange,
  onAssigneeChange,
  onSuiteSelectionChange,
  onPreviewSmartExecution,
  onSmartExecutionIntegrationChange,
  onSmartExecutionReleaseScopeChange,
  onSmartExecutionAdditionalContextChange,
  onSmartExecutionRequirementSearchChange,
  onToggleSmartExecutionRequirement,
  onToggleSmartExecutionCase,
  onSelectAllSmartExecutionRequirements,
  onClearSmartExecutionRequirements,
  onSelectAllSmartExecutionCases,
  onClearSmartExecutionCases,
  canCreateExecution,
  isPreviewingSmartExecution,
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
  executionCreateMode: ExecutionCreateMode;
  onExecutionCreateModeChange: (value: ExecutionCreateMode) => void;
  selectedProject: string;
  selectedAppType: string;
  scopeSuites: TestSuite[];
  selectedSuiteIds: string[];
  executionName: string;
  selectedEnvironmentId: string;
  selectedConfigurationId: string;
  selectedDataSetId: string;
  selectedExecutionAssigneeId: string;
  assigneeOptions: ExecutionAssigneeOption[];
  integrations: Integration[];
  smartExecutionIntegrationId: string;
  smartExecutionReleaseScope: string;
  smartExecutionAdditionalContext: string;
  smartExecutionRequirementOptions: SmartExecutionRequirementOption[];
  smartExecutionRequirementSearch: string;
  smartExecutionPreview: SmartExecutionPreviewResponse | null;
  selectedSmartRequirementIds: string[];
  selectedSmartExecutionCaseIds: string[];
  smartExecutionPreviewMessage: string;
  smartExecutionPreviewTone: "success" | "error";
  onExecutionNameChange: (value: string) => void;
  onEnvironmentChange: (value: string) => void;
  onConfigurationChange: (value: string) => void;
  onDataSetChange: (value: string) => void;
  onAssigneeChange: (value: string) => void;
  onSuiteSelectionChange: (nextIds: string[]) => void;
  onPreviewSmartExecution: () => void;
  onSmartExecutionIntegrationChange: (value: string) => void;
  onSmartExecutionReleaseScopeChange: (value: string) => void;
  onSmartExecutionAdditionalContextChange: (value: string) => void;
  onSmartExecutionRequirementSearchChange: (value: string) => void;
  onToggleSmartExecutionRequirement: (requirementId: string) => void;
  onToggleSmartExecutionCase: (testCaseId: string) => void;
  onSelectAllSmartExecutionRequirements: (requirementIds: string[]) => void;
  onClearSmartExecutionRequirements: () => void;
  onSelectAllSmartExecutionCases: () => void;
  onClearSmartExecutionCases: () => void;
  canCreateExecution: boolean;
  isPreviewingSmartExecution: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isSmartMode = executionCreateMode === "smart";
  const smartPreviewCases = smartExecutionPreview?.cases || [];
  const hasSmartPlanningInput = Boolean(smartExecutionReleaseScope.trim() || smartExecutionAdditionalContext.trim());
  const normalizedRequirementSearch = smartExecutionRequirementSearch.trim().toLowerCase();
  const filteredSmartRequirementOptions = normalizedRequirementSearch
    ? smartExecutionRequirementOptions.filter((requirement) =>
        [requirement.title, requirement.description || ""].some((value) => value.toLowerCase().includes(normalizedRequirementSearch))
      )
    : smartExecutionRequirementOptions;
  const areAllVisibleSmartRequirementsSelected =
    Boolean(filteredSmartRequirementOptions.length)
    && filteredSmartRequirementOptions.every((requirement) => selectedSmartRequirementIds.includes(requirement.id));
  const selectedSmartCaseCount = selectedSmartExecutionCaseIds.length;
  const areAllSmartCasesSelected = Boolean(smartPreviewCases.length) && selectedSmartCaseCount === smartPreviewCases.length;

  return (
    <div className="modal-backdrop modal-backdrop--scroll" onClick={() => !isSubmitting && onClose()} role="presentation">
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
              <p>Choose a manual suite snapshot or let AI plan an impact-based run from your release scope and existing library.</p>
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

            <div className="execution-create-grid">
              <FormField label="Execution name">
                <input value={executionName} onChange={(event) => onExecutionNameChange(event.target.value)} />
              </FormField>

              <FormField label="Assign to" hint="Sets the default owner for this execution and any snapped test case that does not override it later.">
                <select
                  disabled={!projectId || !assigneeOptions.length}
                  value={selectedExecutionAssigneeId}
                  onChange={(event) => onAssigneeChange(event.target.value)}
                >
                  <option value="">
                    {!projectId ? "Select a project first" : assigneeOptions.length ? "Unassigned" : "No project members available"}
                  </option>
                  {assigneeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.caption ? `${option.label} · ${option.caption}` : option.label}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>

            <div className="execution-mode-switch" aria-label="Execution creation mode" role="group">
              <button
                aria-pressed={!isSmartMode}
                className={!isSmartMode ? "execution-mode-button is-active" : "execution-mode-button"}
                onClick={() => onExecutionCreateModeChange("manual")}
                type="button"
              >
                <strong>Manual snapshot</strong>
                <span>Create a run from selected suites.</span>
              </button>
              <button
                aria-pressed={isSmartMode}
                className={isSmartMode ? "execution-mode-button is-active" : "execution-mode-button"}
                onClick={() => onExecutionCreateModeChange("smart")}
                type="button"
              >
                <strong>AI Smart Execution</strong>
                <span>Pick impacted cases from release scope.</span>
              </button>
            </div>

            <div className="detail-summary">
              <strong>{selectedProject || "Select a project to continue"}</strong>
              <span>{selectedAppType ? `${selectedAppType} app type selected for this execution.` : "Choose an app type to continue."}</span>
              <span>
                {isSmartMode
                  ? smartExecutionPreview
                    ? `${smartExecutionPreview.source_case_count} existing cases are available for impact analysis in this app type.`
                    : "AI smart execution screens the current app type's existing cases exported as CSV."
                  : scopeSuites.length
                    ? `${scopeSuites.length} suites available in the current scope.`
                    : "No suites available in the current scope yet."}
              </span>
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

            {isSmartMode ? (
              <div className="ai-studio-shell execution-smart-shell">
                <div className="ai-studio-sidebar">
                  <section className="ai-studio-panel">
                    <div className="panel-head">
                      <div>
                        <h3>Release impact prompt</h3>
                        <p>Shape the AI prompt with release scope, additional context, or both before previewing impacted coverage.</p>
                      </div>
                    </div>

                    <FormField label="LLM integration">
                      <select value={smartExecutionIntegrationId} onChange={(event) => onSmartExecutionIntegrationChange(event.target.value)}>
                        <option value="">Default active integration</option>
                        {integrations.map((integration) => (
                          <option key={integration.id} value={integration.id}>
                            {integration.name}
                          </option>
                        ))}
                      </select>
                    </FormField>

                    <FormField label="Release scope" hint="Provide release scope, additional context, or both. AI can plan from either field.">
                      <textarea
                        placeholder="Summarize the release changes, touched modules, high-risk workflows, integrations, data movement, and regression concerns..."
                        rows={7}
                        value={smartExecutionReleaseScope}
                        onChange={(event) => onSmartExecutionReleaseScopeChange(event.target.value)}
                      />
                    </FormField>

                    <FormField label="Additional context" hint="Optional on its own too: rollout notes, known gaps, compliance focus, customer risk, or environment context.">
                      <textarea
                        placeholder="Environment notes, rollout risks, known gaps, customer impact, compliance focus..."
                        rows={5}
                        value={smartExecutionAdditionalContext}
                        onChange={(event) => onSmartExecutionAdditionalContextChange(event.target.value)}
                      />
                    </FormField>

                    <FormField label="Impacted requirements">
                      <div className="execution-smart-requirements-panel">
                        <div className="execution-smart-requirement-toolbar">
                          <input
                            placeholder="Filter linked requirements"
                            value={smartExecutionRequirementSearch}
                            onChange={(event) => onSmartExecutionRequirementSearchChange(event.target.value)}
                          />
                          <button
                            className="ghost-button"
                            disabled={!filteredSmartRequirementOptions.length || areAllVisibleSmartRequirementsSelected}
                            onClick={() => onSelectAllSmartExecutionRequirements(filteredSmartRequirementOptions.map((requirement) => requirement.id))}
                            type="button"
                          >
                            Select visible
                          </button>
                          <button
                            className="ghost-button"
                            disabled={!selectedSmartRequirementIds.length}
                            onClick={onClearSmartExecutionRequirements}
                            type="button"
                          >
                            Clear
                          </button>
                        </div>

                        {smartExecutionRequirementOptions.length ? (
                          <div className="execution-smart-requirement-list">
                            {filteredSmartRequirementOptions.map((requirement) => {
                              const isSelected = selectedSmartRequirementIds.includes(requirement.id);

                              return (
                                <label
                                  className={isSelected ? "execution-smart-requirement-card is-selected" : "execution-smart-requirement-card"}
                                  key={requirement.id}
                                >
                                  <input
                                    checked={isSelected}
                                    onChange={() => onToggleSmartExecutionRequirement(requirement.id)}
                                    type="checkbox"
                                  />
                                  <div className="execution-smart-requirement-copy">
                                    <strong>{requirement.title}</strong>
                                    <span>{requirement.description || "Requirement-linked coverage available in this app type."}</span>
                                  </div>
                                  <span className="execution-smart-requirement-count">
                                    {requirement.linkedCaseCount} case{requirement.linkedCaseCount === 1 ? "" : "s"}
                                  </span>
                                </label>
                              );
                            })}

                            {!filteredSmartRequirementOptions.length ? (
                              <div className="empty-state compact">No linked requirements match the current search.</div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="empty-state compact">No requirement-linked test cases are available for this app type yet.</div>
                        )}
                      </div>
                    </FormField>

                    <div className="detail-summary compact-summary">
                      <strong>{selectedSmartRequirementIds.length ? `${selectedSmartRequirementIds.length} impacted requirement${selectedSmartRequirementIds.length === 1 ? "" : "s"} selected` : "Requirement filter is optional"}</strong>
                      <span>
                        {selectedSmartRequirementIds.length
                          ? "AI will screen only the cases linked to the selected requirements before building the Default execution suite."
                          : "Choose impacted requirements if you want AI to narrow the candidate cases before planning the execution."}
                      </span>
                    </div>

                    <div className="detail-summary compact-summary">
                      <strong>{smartExecutionPreview?.default_suite.name || "Default"} suite target</strong>
                      <span>AI-selected cases are staged under the built-in Default suite so the run stays focused on impacted coverage instead of suite hierarchy.</span>
                    </div>
                  </section>
                </div>

                <div className="ai-studio-main">
                  <div className="detail-summary">
                    <strong>{smartExecutionPreview ? `${selectedSmartCaseCount} impacted cases selected` : "AI Smart Execution"}</strong>
                    <span>{smartExecutionPreview ? smartExecutionPreview.summary : "Generate an impact-based execution plan from release scope, additional context, or both."}</span>
                    <span>
                      {smartExecutionPreview
                        ? `${smartExecutionPreview.source_case_count} existing cases were screened and ${smartExecutionPreview.matched_case_count} cases were suggested for this run.`
                        : selectedSmartRequirementIds.length
                          ? `AI will use the selected project, app type, execution context, and only the cases linked to ${selectedSmartRequirementIds.length} selected requirement${selectedSmartRequirementIds.length === 1 ? "" : "s"}.`
                          : "AI uses the selected project, app type, execution context, and existing cases exported as CSV."}
                    </span>
                  </div>

                  {smartExecutionPreviewMessage ? (
                    <p className={smartExecutionPreviewTone === "error" ? "inline-message error-message" : "inline-message success-message"}>
                      {smartExecutionPreviewMessage}
                    </p>
                  ) : null}

                  {!integrations.length ? (
                    <div className="inline-message error-message">
                      No active LLM integrations are available yet. Create one in Integrations to use AI smart execution.
                    </div>
                  ) : null}

                  <div className="action-row">
                    <button
                      className="primary-button"
                      disabled={!projectId || !appTypeId || !hasSmartPlanningInput || isPreviewingSmartExecution || isSubmitting || !integrations.length}
                      onClick={onPreviewSmartExecution}
                      type="button"
                    >
                      {isPreviewingSmartExecution ? "Planning…" : "Generate impact preview"}
                    </button>
                    <button
                      className="ghost-button"
                      disabled={!smartPreviewCases.length || areAllSmartCasesSelected}
                      onClick={onSelectAllSmartExecutionCases}
                      type="button"
                    >
                      Select all
                    </button>
                    <button
                      className="ghost-button"
                      disabled={!selectedSmartCaseCount}
                      onClick={onClearSmartExecutionCases}
                      type="button"
                    >
                      Clear selection
                    </button>
                  </div>

                  {smartExecutionPreview ? (
                    <div className="selection-summary-card execution-smart-summary-card">
                      <div className="selection-summary-header">
                        <div>
                          <strong>{smartExecutionPreview.execution_name}</strong>
                          <span>{smartExecutionPreview.summary}</span>
                        </div>
                        <span className="count-pill">{selectedSmartCaseCount}/{smartExecutionPreview.matched_case_count} selected</span>
                      </div>
                    </div>
                  ) : null}

                  <div className="execution-smart-impact-list">
                    {smartPreviewCases.map((testCase) => {
                      const isSelected = selectedSmartExecutionCaseIds.includes(testCase.test_case_id);

                      return (
                        <label
                          className={isSelected ? "execution-smart-impact-card is-selected" : "execution-smart-impact-card"}
                          key={testCase.test_case_id}
                        >
                          <input
                            checked={isSelected}
                            onChange={() => onToggleSmartExecutionCase(testCase.test_case_id)}
                            type="checkbox"
                          />
                          <div className="execution-smart-impact-body">
                            <div className="execution-smart-impact-top">
                              <div className="execution-smart-impact-heading">
                                <strong>{testCase.title}</strong>
                                <span>{testCase.description || "No description available."}</span>
                              </div>
                              <div className="execution-smart-impact-facts">
                                <span className={`execution-smart-impact-level is-${testCase.impact_level}`}>
                                  {executionImpactLevelLabel(testCase.impact_level)}
                                </span>
                                <span className="count-pill">
                                  {testCase.step_count} step{testCase.step_count === 1 ? "" : "s"}
                                </span>
                              </div>
                            </div>

                            <p className="execution-smart-impact-reason">{testCase.reason}</p>

                            <div className="detail-summary compact-summary">
                              <strong>{testCase.suite_names.length ? testCase.suite_names.join(" · ") : "No suite mapping"}</strong>
                              <span>
                                {testCase.requirement_titles.length
                                  ? `Requirements: ${testCase.requirement_titles.join(" · ")}`
                                  : "No linked requirements"}
                              </span>
                            </div>
                          </div>
                        </label>
                      );
                    })}

                    {smartExecutionPreview && !smartPreviewCases.length ? (
                      <div className="empty-state compact">No impacted cases were identified for the current release scope.</div>
                    ) : null}
                    {!smartExecutionPreview ? (
                      <div className="empty-state compact">Generate a preview to review the impacted cases that will be staged under Default.</div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <FormField label="Suite scope" required>
                  <div className="suite-modal-picker-shell suite-modal-picker-shell--scope">
                    <SuiteScopePicker
                      description="Select the suites to snapshot for this execution, then adjust their order if you want a different run sequence."
                      emptyMessage="No suites available for the current app type."
                      heading="Available suites"
                      onChange={onSuiteSelectionChange}
                      selectedSuiteIds={selectedSuiteIds}
                      suites={scopeSuites}
                    />
                  </div>
                </FormField>

                {!scopeSuites.length && appTypeId ? <div className="empty-state compact">No suites available for this app type. Create a suite first.</div> : null}
              </>
            )}
          </div>

          <div className="action-row execution-create-actions">
            <button className="primary-button" disabled={!canCreateExecution || isSubmitting || (isSmartMode && isPreviewingSmartExecution)} type="submit">
              {isSubmitting ? "Creating…" : isSmartMode ? "Create AI smart execution" : "Create execution"}
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

function CreateExecutionScheduleModal({
  projectId,
  projectName,
  appTypeId,
  appTypeName,
  scopeSuites,
  selectedSuiteIds,
  executionName,
  selectedEnvironmentId,
  selectedConfigurationId,
  selectedDataSetId,
  selectedAssigneeId,
  assigneeOptions,
  cadence,
  nextRunAt,
  isSubmitting,
  onExecutionNameChange,
  onEnvironmentChange,
  onConfigurationChange,
  onDataSetChange,
  onAssigneeChange,
  onSuiteSelectionChange,
  onCadenceChange,
  onNextRunAtChange,
  onClose,
  onSubmit
}: {
  projectId: string;
  projectName: string;
  appTypeId: string;
  appTypeName: string;
  scopeSuites: TestSuite[];
  selectedSuiteIds: string[];
  executionName: string;
  selectedEnvironmentId: string;
  selectedConfigurationId: string;
  selectedDataSetId: string;
  selectedAssigneeId: string;
  assigneeOptions: ExecutionAssigneeOption[];
  cadence: ExecutionScheduleCadence;
  nextRunAt: string;
  isSubmitting: boolean;
  onExecutionNameChange: (value: string) => void;
  onEnvironmentChange: (value: string) => void;
  onConfigurationChange: (value: string) => void;
  onDataSetChange: (value: string) => void;
  onAssigneeChange: (value: string) => void;
  onSuiteSelectionChange: (nextIds: string[]) => void;
  onCadenceChange: (value: ExecutionScheduleCadence) => void;
  onNextRunAtChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-backdrop modal-backdrop--scroll" onClick={() => !isSubmitting && onClose()} role="presentation">
      <div
        aria-labelledby="create-execution-schedule-title"
        aria-modal="true"
        className="modal-card execution-create-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <form className="execution-create-form" onSubmit={onSubmit}>
          <div className="execution-create-header">
            <div className="execution-create-title">
              <p className="eyebrow">Scheduled Runs</p>
              <h3 id="create-execution-schedule-title">Create schedule</h3>
              <p>Save a recurring run separately from the live execution board, then launch it when needed.</p>
            </div>
            <button aria-label="Close create schedule dialog" className="ghost-button" disabled={isSubmitting} onClick={onClose} type="button">
              Close
            </button>
          </div>

          <div className="execution-create-body">
            <div className="detail-summary">
              <strong>{projectName || "Select a project to continue"}</strong>
              <span>{appTypeName ? `${appTypeName} app type selected for this schedule.` : "Choose an app type before scheduling."}</span>
              <span>{scopeSuites.length ? `${scopeSuites.length} suites available for recurring runs.` : "No suites available yet in the selected scope."}</span>
            </div>

            <div className="execution-create-grid">
              <FormField label="Schedule name">
                <input value={executionName} onChange={(event) => onExecutionNameChange(event.target.value)} />
              </FormField>
              <FormField label="Assign to" hint="This user becomes the default owner each time the scheduled run creates a fresh execution.">
                <select
                  disabled={!projectId || !assigneeOptions.length}
                  value={selectedAssigneeId}
                  onChange={(event) => onAssigneeChange(event.target.value)}
                >
                  <option value="">
                    {!projectId ? "Select a project first" : assigneeOptions.length ? "Unassigned" : "No project members available"}
                  </option>
                  {assigneeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.caption ? `${option.label} · ${option.caption}` : option.label}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>

            <div className="execution-create-grid">
              <FormField label="Cadence" required>
                <select value={cadence} onChange={(event) => onCadenceChange(event.target.value as ExecutionScheduleCadence)}>
                  <option value="once">Once</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </FormField>
              <FormField label="First run" required>
                <input type="datetime-local" value={nextRunAt} onChange={(event) => onNextRunAtChange(event.target.value)} />
              </FormField>
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

            <FormField label="Execution scope" required>
              <SuiteScopePicker
                description="Pick the reusable suites that should be snapped whenever this schedule runs."
                emptyMessage="No suites available in this app type yet."
                heading="Scheduled suite scope"
                onChange={onSuiteSelectionChange}
                selectedSuiteIds={selectedSuiteIds}
                suites={scopeSuites}
              />
            </FormField>
          </div>

          <div className="action-row execution-create-actions">
            <button className="primary-button" disabled={!projectId || !appTypeId || !selectedSuiteIds.length || !nextRunAt || isSubmitting} type="submit">
              {isSubmitting ? "Saving…" : "Create schedule"}
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

function ExecutionContextSnapshotSummary({
  execution,
  onViewFull
}: {
  execution: Execution;
  onViewFull?: () => void;
}) {
  const environmentSummary = execution.test_environment?.snapshot;
  const configurationSummary = execution.test_configuration?.snapshot;
  const dataSetSummary = execution.test_data_set?.snapshot;
  const configurationTarget = [
    configurationSummary?.browser,
    configurationSummary?.mobile_os,
    configurationSummary?.platform_version
  ].filter(Boolean).join(" · ");

  return (
    <div className="execution-context-summary-shell">
      <div className="execution-context-summary-head">
        <div className="execution-context-summary-copy">
          <strong>Execution context snapshot</strong>
          <span>Environment, configuration, and test data were frozen when this execution was created.</span>
        </div>
        {onViewFull ? (
          <button className="ghost-button" onClick={onViewFull} type="button">
            View full context
          </button>
        ) : null}
      </div>

      <div className="execution-context-cards">
        <div className="execution-context-card">
          <span>Environment snapshot</span>
          <strong>{environmentSummary?.name || execution.test_environment?.name || "No environment attached"}</strong>
          <small>{environmentSummary?.base_url || environmentSummary?.browser || "No environment snapshot details recorded."}</small>
        </div>
        <div className="execution-context-card">
          <span>Configuration snapshot</span>
          <strong>{configurationSummary?.name || execution.test_configuration?.name || "No configuration attached"}</strong>
          <small>{configurationTarget || (configurationSummary?.variables?.length ? `${configurationSummary.variables.length} variables available` : "No configuration snapshot details recorded.")}</small>
        </div>
        <div className="execution-context-card">
          <span>Data snapshot</span>
          <strong>{dataSetSummary?.name || execution.test_data_set?.name || "No data set attached"}</strong>
          <small>
            {dataSetSummary
              ? dataSetSummary.mode === "table"
                ? `${dataSetSummary.rows.length} table rows snapped`
                : `${dataSetSummary.rows.length} key/value pairs snapped`
              : "No data snapshot details recorded."}
          </small>
        </div>
      </div>
    </div>
  );
}

function ExecutionContextSnapshotModal({
  execution,
  onClose
}: {
  execution: Execution;
  onClose: () => void;
}) {
  const environmentSummary = execution.test_environment?.snapshot;
  const configurationSummary = execution.test_configuration?.snapshot;
  const dataSetSummary = execution.test_data_set?.snapshot;

  return (
    <div className="modal-backdrop modal-backdrop--scroll" onClick={onClose} role="presentation">
      <div
        aria-labelledby="execution-context-modal-title"
        aria-modal="true"
        className="modal-card execution-context-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="execution-context-modal-header">
          <div className="execution-context-modal-copy">
            <p className="eyebrow">Execution Context Snapshot</p>
            <h3 id="execution-context-modal-title">{execution.name || "Selected execution"}</h3>
            <p>Review the exact environment, configuration, and test data preserved with this run. Later edits to reusable resources do not change this snapshot.</p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="execution-context-modal-body">
          <ExecutionContextSnapshotSummary execution={execution} />

          <div className="execution-context-modal-layout">
            <ExecutionContextSnapshotSection
              description="Base URL, browser, notes, and environment variables preserved for this execution."
              title={environmentSummary?.name || execution.test_environment?.name || "No environment attached"}
            >
              {environmentSummary ? (
                <>
                  <ExecutionContextMetaGrid
                    items={[
                      { label: "Base URL", value: environmentSummary.base_url || "Not set" },
                      { label: "Browser", value: environmentSummary.browser || "Not set" },
                      {
                        label: "Variables",
                        value: `${environmentSummary.variables.length} variable${environmentSummary.variables.length === 1 ? "" : "s"}`
                      }
                    ]}
                  />
                  {environmentSummary.description ? (
                    <ExecutionContextSnapshotCopyBlock label="Description" value={environmentSummary.description} />
                  ) : null}
                  {environmentSummary.notes ? (
                    <ExecutionContextSnapshotCopyBlock label="Notes" value={environmentSummary.notes} />
                  ) : null}
                  <ExecutionContextVariableTable
                    emptyMessage="No environment variables were snapshotted for this run."
                    entries={environmentSummary.variables}
                    title="Environment variables"
                  />
                </>
              ) : (
                <div className="empty-state compact">No environment snapshot details were recorded for this execution.</div>
              )}
            </ExecutionContextSnapshotSection>

            <ExecutionContextSnapshotSection
              description="Browser, mobile target, platform version, and configuration variables preserved with the run."
              title={configurationSummary?.name || execution.test_configuration?.name || "No configuration attached"}
            >
              {configurationSummary ? (
                <>
                  <ExecutionContextMetaGrid
                    items={[
                      { label: "Browser", value: configurationSummary.browser || "Not set" },
                      { label: "Mobile OS", value: configurationSummary.mobile_os || "Not set" },
                      { label: "Platform version", value: configurationSummary.platform_version || "Not set" },
                      {
                        label: "Variables",
                        value: `${configurationSummary.variables.length} variable${configurationSummary.variables.length === 1 ? "" : "s"}`
                      }
                    ]}
                  />
                  {configurationSummary.description ? (
                    <ExecutionContextSnapshotCopyBlock label="Description" value={configurationSummary.description} />
                  ) : null}
                  <ExecutionContextVariableTable
                    emptyMessage="No configuration variables were snapshotted for this run."
                    entries={configurationSummary.variables}
                    title="Configuration variables"
                  />
                </>
              ) : (
                <div className="empty-state compact">No configuration snapshot details were recorded for this execution.</div>
              )}
            </ExecutionContextSnapshotSection>

            <ExecutionContextSnapshotSection
              description="The data rows below are the exact execution data snapshot used for this run."
              title={dataSetSummary?.name || execution.test_data_set?.name || "No data set attached"}
            >
              {dataSetSummary ? (
                <>
                  <ExecutionContextMetaGrid
                    items={[
                      { label: "Mode", value: dataSetSummary.mode === "table" ? "Table data" : "Key/value data" },
                      { label: "Columns", value: String(dataSetSummary.columns.length) },
                      { label: "Rows", value: String(dataSetSummary.rows.length) }
                    ]}
                  />
                  {dataSetSummary.description ? (
                    <ExecutionContextSnapshotCopyBlock label="Description" value={dataSetSummary.description} />
                  ) : null}
                  <ExecutionContextDataTable snapshot={dataSetSummary} />
                </>
              ) : (
                <div className="empty-state compact">No test data snapshot details were recorded for this execution.</div>
              )}
            </ExecutionContextSnapshotSection>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExecutionContextSnapshotSection({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="execution-context-modal-section">
      <div className="execution-context-modal-section-head">
        <div className="execution-context-modal-section-copy">
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ExecutionContextMetaGrid({
  items
}: {
  items: Array<{
    label: string;
    value: string;
  }>;
}) {
  return (
    <div className="execution-context-modal-meta">
      {items.map((item) => (
        <div className="execution-context-modal-meta-card" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function ExecutionContextSnapshotCopyBlock({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="execution-context-modal-copy-block">
      <strong>{label}</strong>
      <p>{value}</p>
    </div>
  );
}

function ExecutionContextVariableTable({
  entries,
  title,
  emptyMessage
}: {
  entries: KeyValueEntry[];
  title: string;
  emptyMessage: string;
}) {
  return (
    <div className="resource-table-shell execution-context-table-shell">
      <div className="resource-table-toolbar">
        <strong>{title}</strong>
        <span className="count-pill">{entries.length} item{entries.length === 1 ? "" : "s"}</span>
      </div>
      {!entries.length ? <div className="empty-state compact resource-table-empty">{emptyMessage}</div> : null}
      {entries.length ? (
        <div className="table-wrap execution-context-table-wrap">
          <table className="data-table resource-data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th>Visibility</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.id || `${entry.key}-${index}`}>
                  <td>{entry.key || "Untitled key"}</td>
                  <td>{entry.is_secret ? <span className="execution-context-hidden-value">{entry.has_stored_value ? "Stored secret" : "Hidden secret"}</span> : entry.value || "—"}</td>
                  <td>{entry.is_secret ? "Hidden" : "Visible"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function ExecutionContextDataTable({
  snapshot
}: {
  snapshot: ExecutionDataSetSnapshot;
}) {
  if (snapshot.mode === "table") {
    return (
      <div className="resource-table-shell execution-context-table-shell">
        <div className="resource-table-toolbar">
          <strong>Table snapshot</strong>
          <span className="count-pill">{snapshot.rows.length} row{snapshot.rows.length === 1 ? "" : "s"}</span>
        </div>
        {!snapshot.columns.length ? <div className="empty-state compact resource-table-empty">No columns were snapshotted for this data set.</div> : null}
        {snapshot.columns.length ? (
          <div className="table-wrap execution-context-table-wrap">
            <table className="data-table resource-data-table">
              <thead>
                <tr>
                  {snapshot.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot.rows.length ? (
                  snapshot.rows.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`}>
                      {snapshot.columns.map((column) => (
                        <td key={`${rowIndex}-${column}`}>{row[column] || "—"}</td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={snapshot.columns.length}>No rows were snapshotted for this data set.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="resource-table-shell execution-context-table-shell">
      <div className="resource-table-toolbar">
        <strong>Key/value snapshot</strong>
        <span className="count-pill">{snapshot.rows.length} pair{snapshot.rows.length === 1 ? "" : "s"}</span>
      </div>
      {!snapshot.rows.length ? <div className="empty-state compact resource-table-empty">No key/value rows were snapshotted for this data set.</div> : null}
      {snapshot.rows.length ? (
        <div className="table-wrap execution-context-table-wrap">
          <table className="data-table resource-data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  <td>{row.key || `Row ${rowIndex + 1}`}</td>
                  <td>{row.value || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
