import { ChangeEvent, FormEvent, Fragment, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AiDesignStudioModal } from "../components/AiDesignStudioModal";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { ExecutionContextSelector } from "../components/ExecutionContextSelector";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import {
  TileCardCaseIcon,
  TileCardFact,
  TileCardIconFrame,
  TileCardLinkIcon,
  TileCardPriorityIcon,
  TileCardRunsIcon,
  TileCardStatusIndicator,
  TileCardStepsIcon,
  formatTileCardLabel,
  getTileCardTone
} from "../components/TileCardPrimitives";
import { SuiteCasePicker } from "../components/SuiteCasePicker";
import { ToastMessage } from "../components/ToastMessage";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { parseTestCaseCsv, type ImportedTestCaseRow } from "../lib/testCaseImport";
import { api } from "../lib/api";
import { appendUniqueImages, parseExternalLinks, readImageFiles, toggleRequirementOnPreviewCase } from "../lib/aiDesignStudio";
import type { AiDesignImageInput, AiDesignedTestCaseCandidate, AppType, Execution, ExecutionResult, Project, Requirement, SharedStepGroup, TestCase, TestStep, TestSuite } from "../types";

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

type DraftTestStep = {
  id: string;
  action: string;
  expected_result: string;
  group_id: string | null;
  group_name: string | null;
  group_kind: "local" | "reusable" | null;
  reusable_group_id: string | null;
};

type CopiedTestStep = {
  action: string;
  expected_result: string;
  group_id: string | null;
  group_name: string | null;
  group_kind: "local" | "reusable" | null;
  reusable_group_id: string | null;
};

type StepInsertionGroupContext = Pick<CopiedTestStep, "group_id" | "group_name" | "group_kind" | "reusable_group_id">;

type CutStepSource = {
  stepIds: string[];
  testCaseId: string | null;
  isDraft: boolean;
};

type CaseStepFilter = "all" | "with-steps" | "no-steps";
type CaseRunFilter = "all" | "with-runs" | "no-runs";

type TestCaseEditorSectionKey = "case" | "steps" | "history";

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

const executionHistoryDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const createDefaultTestCaseSections = (): Record<TestCaseEditorSectionKey, boolean> => ({
  case: true,
  steps: false,
  history: false
});

const createDraftStepId = () =>
  globalThis.crypto?.randomUUID?.() || `draft-step-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createDraftGroupId = () =>
  globalThis.crypto?.randomUUID?.() || `draft-group-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const splitImportedStepSequence = (value?: string) =>
  String(value || "")
    .split(/\r?\n|\|/)
    .map((item) => item.trim());

const pickImportedSequenceValue = (items: string[], index: number) => {
  if (!items.length) {
    return "";
  }

  if (index < items.length) {
    return items[index] || "";
  }

  return items.length === 1 ? items[0] || "" : "";
};

const normalizeImportedGroupKind = (value?: string) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z]/g, "");

  if (!normalized) {
    return "";
  }

  if (normalized === "reusable" || normalized === "shared" || normalized === "sharedgroup" || normalized === "snapshot") {
    return "reusable";
  }

  if (normalized === "local" || normalized === "grouped") {
    return "local";
  }

  return "";
};

const buildImportedStepPreview = (row: ImportedTestCaseRow) => {
  const actions = splitImportedStepSequence(row.action);
  const expectedResults = splitImportedStepSequence(row.expected_result);
  const groupNames = splitImportedStepSequence(row.step_group_name);
  const groupKinds = splitImportedStepSequence(row.step_group_kind);
  const sharedGroupIds = splitImportedStepSequence(row.shared_group_id);
  const size = Math.max(actions.length, expectedResults.length, groupNames.length, groupKinds.length, sharedGroupIds.length, 0);

  return Array.from({ length: size }, (_, index) => {
    const action = pickImportedSequenceValue(actions, index);
    const expectedResult = pickImportedSequenceValue(expectedResults, index);
    const groupName = pickImportedSequenceValue(groupNames, index);
    const sharedGroupId = pickImportedSequenceValue(sharedGroupIds, index);
    const resolvedGroupKind = normalizeImportedGroupKind(pickImportedSequenceValue(groupKinds, index)) || (sharedGroupId ? "reusable" : groupName ? "local" : "");

    return {
      action,
      expected_result: expectedResult,
      step_group_name: groupName,
      step_group_kind: resolvedGroupKind,
      shared_group_id: sharedGroupId
    };
  }).filter((step) => step.action || step.expected_result || step.step_group_name || step.shared_group_id);
};

const countImportedSteps = (row: ImportedTestCaseRow) => buildImportedStepPreview(row).length;

const countImportedGroups = (row: ImportedTestCaseRow) => {
  let previousSignature = "";
  let count = 0;

  buildImportedStepPreview(row).forEach((step) => {
    const signature =
      step.step_group_name || step.shared_group_id || step.step_group_kind
        ? `${step.step_group_kind || "local"}::${step.step_group_name || ""}::${step.shared_group_id || ""}`
        : "";

    if (signature && signature !== previousSignature) {
      count += 1;
    }

    previousSignature = signature;
  });

  return count;
};

const getImportedStepPreviewLabel = (row: ImportedTestCaseRow) => {
  const firstStep = buildImportedStepPreview(row)[0];

  if (!firstStep) {
    return "No step content supplied";
  }

  const summary = firstStep.action || firstStep.expected_result || "Grouped step";

  if (!firstStep.step_group_name) {
    return summary;
  }

  return `${summary} · ${firstStep.step_group_kind === "reusable" ? "Shared group" : "Group"}: ${firstStep.step_group_name}`;
};

const normalizeDraftSteps = (steps: DraftTestStep[]) =>
  steps
    .map((step, index) => ({
      step_order: index + 1,
      action: step.action.trim(),
      expected_result: step.expected_result.trim(),
      group_id: step.group_id || undefined,
      group_name: step.group_name?.trim() || undefined,
      group_kind: step.group_kind || undefined,
      reusable_group_id: step.reusable_group_id || undefined
    }))
    .filter((step) => step.action || step.expected_result);

const normalizeCopiedSteps = (
  steps: Array<Pick<TestStep, "action" | "expected_result" | "group_id" | "group_name" | "group_kind" | "reusable_group_id">>
): CopiedTestStep[] =>
  steps.map((step) => ({
    action: step.action || "",
    expected_result: step.expected_result || "",
    group_id: null,
    group_name: null,
    group_kind: null,
    reusable_group_id: null
  }));

const materializeCopiedSteps = (steps: CopiedTestStep[]) => {
  const nextGroupIds = new Map<string, string>();

  return steps.map((step) => {
    const nextGroupId = step.group_id
      ? (nextGroupIds.get(step.group_id) || createDraftGroupId())
      : null;

    if (step.group_id && nextGroupId && !nextGroupIds.has(step.group_id)) {
      nextGroupIds.set(step.group_id, nextGroupId);
    }

    return {
      ...step,
      group_id: nextGroupId
    };
  });
};

const toCsvCell = (value: string | number | null | undefined) => {
  const normalized = String(value ?? "");
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, "\"\"")}"` : normalized;
};

const formatExecutionHistoryDate = (value?: string | null) => {
  if (!value) {
    return "Recent run";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : executionHistoryDateFormatter.format(parsed);
};

export function TestCasesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useState("");
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [caseStatusFilter, setCaseStatusFilter] = useState("all");
  const [casePriorityFilter, setCasePriorityFilter] = useState("all");
  const [caseStepFilter, setCaseStepFilter] = useState<CaseStepFilter>("all");
  const [caseRunFilter, setCaseRunFilter] = useState<CaseRunFilter>("all");
  const [isCreating, setIsCreating] = useState(false);
  const [selectedActionTestCaseIds, setSelectedActionTestCaseIds] = useState<string[]>([]);
  const [isDeletingSelectedTestCases, setIsDeletingSelectedTestCases] = useState(false);
  const [isCreateSuiteModalOpen, setIsCreateSuiteModalOpen] = useState(false);
  const [isCreateExecutionModalOpen, setIsCreateExecutionModalOpen] = useState(false);
  const [executionName, setExecutionName] = useState("");
  const [selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId] = useState("");
  const [selectedExecutionConfigurationId, setSelectedExecutionConfigurationId] = useState("");
  const [selectedExecutionDataSetId, setSelectedExecutionDataSetId] = useState("");
  const [expandedSections, setExpandedSections] = useState<Record<TestCaseEditorSectionKey, boolean>>(createDefaultTestCaseSections);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [caseDraft, setCaseDraft] = useState<TestCaseDraft>(EMPTY_CASE_DRAFT);
  const [newStepDraft, setNewStepDraft] = useState<StepDraft>(EMPTY_STEP_DRAFT);
  const [stepInsertIndex, setStepInsertIndex] = useState<number | null>(null);
  const [stepInsertGroupContext, setStepInsertGroupContext] = useState<StepInsertionGroupContext | null>(null);
  const [draftSteps, setDraftSteps] = useState<DraftTestStep[]>([]);
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([]);
  const [copiedSteps, setCopiedSteps] = useState<CopiedTestStep[]>([]);
  const [copiedStepMode, setCopiedStepMode] = useState<"copy" | "cut">("copy");
  const [cutStepSource, setCutStepSource] = useState<CutStepSource | null>(null);
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
  const [expandedStepGroupIds, setExpandedStepGroupIds] = useState<string[]>([]);
  const [isStepGroupModalOpen, setIsStepGroupModalOpen] = useState(false);
  const [stepGroupName, setStepGroupName] = useState("");
  const [saveAsReusableGroup, setSaveAsReusableGroup] = useState(false);
  const [isSharedGroupPickerOpen, setIsSharedGroupPickerOpen] = useState(false);
  const [selectedSharedGroupId, setSelectedSharedGroupId] = useState("");
  const [sharedGroupSearchTerm, setSharedGroupSearchTerm] = useState("");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importRows, setImportRows] = useState<ImportedTestCaseRow[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importRequirementId, setImportRequirementId] = useState("");
  const [isAiStudioOpen, setIsAiStudioOpen] = useState(false);
  const [aiRequirementIds, setAiRequirementIds] = useState<string[]>([]);
  const [integrationId, setIntegrationId] = useState("");
  const [maxCases, setMaxCases] = useState(8);
  const [aiAdditionalContext, setAiAdditionalContext] = useState("");
  const [aiExternalLinksText, setAiExternalLinksText] = useState("");
  const [aiReferenceImages, setAiReferenceImages] = useState<AiDesignImageInput[]>([]);
  const [aiPreviewCases, setAiPreviewCases] = useState<AiDesignedTestCaseCandidate[]>([]);
  const [aiPreviewMessage, setAiPreviewMessage] = useState("");
  const [aiPreviewTone, setAiPreviewTone] = useState<"success" | "error">("success");

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
  const suitesQuery = useQuery({
    queryKey: ["test-case-suites", appTypeId],
    queryFn: () => api.testSuites.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const testCasesQuery = useQuery({
    queryKey: ["global-test-cases", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const executionsQuery = useQuery({
    queryKey: ["executions", projectId],
    queryFn: () => api.executions.list(projectId ? { project_id: projectId } : undefined),
    enabled: Boolean(projectId)
  });
  const sharedStepGroupsQuery = useQuery({
    queryKey: ["shared-step-groups", appTypeId],
    queryFn: () => api.sharedStepGroups.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const executionResultsQuery = useQuery({
    queryKey: ["global-test-case-results", appTypeId],
    queryFn: () => api.executionResults.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const allTestStepsQuery = useQuery({
    queryKey: ["global-test-steps", appTypeId],
    queryFn: () => api.testSteps.list(),
    enabled: Boolean(appTypeId)
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations", "llm"],
    queryFn: () => api.integrations.list({ type: "llm", is_active: true })
  });
  const stepsQuery = useQuery({
    queryKey: ["test-case-steps", selectedTestCaseId],
    queryFn: () => api.testSteps.list({ test_case_id: selectedTestCaseId }),
    enabled: Boolean(selectedTestCaseId)
  });

  const createTestCase = useMutation({ mutationFn: api.testCases.create });
  const createSuite = useMutation({ mutationFn: api.testSuites.create });
  const assignSuiteCases = useMutation({
    mutationFn: ({ id, testCaseIds }: { id: string; testCaseIds: string[] }) => api.testSuites.assignTestCases(id, testCaseIds)
  });
  const createExecution = useMutation({ mutationFn: api.executions.create });
  const updateTestCase = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testCases.update>[1] }) =>
      api.testCases.update(id, input)
  });
  const deleteTestCase = useMutation({ mutationFn: api.testCases.delete });
  const importTestCases = useMutation({ mutationFn: api.testCases.bulkImport });
  const previewDesignedCases = useMutation({ mutationFn: api.testCases.previewDesignedCases });
  const acceptDesignedCases = useMutation({ mutationFn: api.testCases.acceptDesignedCases });
  const createStep = useMutation({ mutationFn: api.testSteps.create });
  const groupSteps = useMutation({ mutationFn: api.testSteps.group });
  const ungroupSteps = useMutation({ mutationFn: api.testSteps.ungroup });
  const insertSharedGroup = useMutation({ mutationFn: api.testSteps.insertSharedGroup });
  const createSharedStepGroup = useMutation({ mutationFn: api.sharedStepGroups.create });
  const updateStep = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testSteps.update>[1] }) =>
      api.testSteps.update(id, input)
  });
  const reorderSteps = useMutation({
    mutationFn: ({ testCaseId, stepIds }: { testCaseId: string; stepIds: string[] }) =>
      api.testSteps.reorder(testCaseId, stepIds)
  });
  const deleteStep = useMutation({ mutationFn: api.testSteps.delete });

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const requirements = requirementsQuery.data || [];
  const suites = suitesQuery.data || [];
  const testCases = testCasesQuery.data || [];
  const executions = executionsQuery.data || [];
  const sharedStepGroups = sharedStepGroupsQuery.data || [];
  const executionResults = executionResultsQuery.data || [];
  const allTestSteps = allTestStepsQuery.data || [];
  const integrations = integrationsQuery.data || [];
  const steps = useMemo(
    () => ((stepsQuery.data || []) as TestStep[]).slice().sort((left, right) => left.step_order - right.step_order),
    [stepsQuery.data]
  );
  const displaySteps = useMemo(
    () =>
      isCreating
        ? draftSteps.map((step, index) => ({
            id: step.id,
            test_case_id: selectedTestCaseId || "draft",
            step_order: index + 1,
            action: step.action,
            expected_result: step.expected_result,
            group_id: step.group_id,
            group_name: step.group_name,
            group_kind: step.group_kind,
            reusable_group_id: step.reusable_group_id
          }))
        : steps,
    [draftSteps, isCreating, selectedTestCaseId, steps]
  );

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const resetExecutionContextSelection = () => {
    setSelectedExecutionEnvironmentId("");
    setSelectedExecutionConfigurationId("");
    setSelectedExecutionDataSetId("");
  };

  const closeCreateExecutionModal = () => {
    setIsCreateExecutionModalOpen(false);
    setExecutionName("");
    resetExecutionContextSelection();
  };

  const beginCreateCase = () => {
    setIsCreating(true);
    setSelectedTestCaseId("");
    setCaseDraft(EMPTY_CASE_DRAFT);
    setDraftSteps([]);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setSelectedStepIds([]);
    setExpandedStepIds([]);
    setExpandedStepGroupIds([]);
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
    setSelectedTestCaseId("");
    setIsCreating(false);
    setIsImportModalOpen(false);
    setIsCreateSuiteModalOpen(false);
    setIsCreateExecutionModalOpen(false);
    setExecutionName("");
    resetExecutionContextSelection();
    setCaseDraft(EMPTY_CASE_DRAFT);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setDraftSteps([]);
    setSelectedStepIds([]);
    setCopiedSteps([]);
    setCopiedStepMode("copy");
    setCutStepSource(null);
    setExpandedStepIds([]);
    setExpandedStepGroupIds([]);
    setIsStepGroupModalOpen(false);
    setStepGroupName("");
    setSaveAsReusableGroup(false);
    setIsSharedGroupPickerOpen(false);
    setSelectedSharedGroupId("");
    setSharedGroupSearchTerm("");
    setSelectedActionTestCaseIds([]);
    setImportRows([]);
    setImportWarnings([]);
    setImportFileName("");
    setImportRequirementId("");
    setIsAiStudioOpen(false);
    setAiRequirementIds([]);
    setAiPreviewCases([]);
    setAiPreviewMessage("");
  }, [appTypeId]);

  useEffect(() => {
    setSelectedActionTestCaseIds((current) => current.filter((id) => testCases.some((item) => item.id === id)));
  }, [testCases]);

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

  const stepCountByCaseId = useMemo(() => {
    const scopedCaseIds = new Set(testCases.map((testCase) => testCase.id));
    const counts: Record<string, number> = {};

    allTestSteps.forEach((step) => {
      if (!scopedCaseIds.has(step.test_case_id)) {
        return;
      }

      counts[step.test_case_id] = (counts[step.test_case_id] || 0) + 1;
    });

    return counts;
  }, [allTestSteps, testCases]);

  const requirementTitleById = useMemo(
    () =>
      requirements.reduce<Record<string, string>>((map, requirement) => {
        map[requirement.id] = requirement.title;
        return map;
      }, {}),
    [requirements]
  );

  const caseStatusOptions = useMemo(
    () =>
      Array.from(
        new Set(
          testCases.map((testCase) => {
            const history = historyByCaseId[testCase.id] || [];
            return history[0]?.status || testCase.status || "active";
          })
        )
      ).sort((left, right) => left.localeCompare(right)),
    [historyByCaseId, testCases]
  );
  const casePriorityOptions = useMemo(
    () => Array.from(new Set(testCases.map((testCase) => String(testCase.priority || 3)))).sort((left, right) => Number(left) - Number(right)),
    [testCases]
  );

  const filteredCases = useMemo(() => {
    const search = deferredSearchTerm.trim().toLowerCase();

    return testCases.filter((testCase) => {
      const requirementTitle =
        (testCase.requirement_ids || [testCase.requirement_id]).map((id) => (id ? requirementTitleById[id] || "" : "")).find(Boolean) || "";
      const history = historyByCaseId[testCase.id] || [];
      const latest = history[0];
      const derivedStatus = latest?.status || testCase.status || "active";
      const stepCount = stepCountByCaseId[testCase.id] || 0;
      const runCount = history.length;

      const matchesSearch =
        !search ||
        [
          testCase.title,
          testCase.description || "",
          requirementTitle
        ].some((value) => value.toLowerCase().includes(search));

      if (!matchesSearch) {
        return false;
      }

      if (caseStatusFilter !== "all" && derivedStatus !== caseStatusFilter) {
        return false;
      }

      if (casePriorityFilter !== "all" && String(testCase.priority || 3) !== casePriorityFilter) {
        return false;
      }

      if (caseStepFilter === "with-steps" && !stepCount) {
        return false;
      }

      if (caseStepFilter === "no-steps" && stepCount) {
        return false;
      }

      if (caseRunFilter === "with-runs" && !runCount) {
        return false;
      }

      if (caseRunFilter === "no-runs" && runCount) {
        return false;
      }

      return true;
    });
  }, [casePriorityFilter, caseRunFilter, caseStatusFilter, caseStepFilter, deferredSearchTerm, historyByCaseId, requirementTitleById, stepCountByCaseId, testCases]);

  const activeCaseFilterCount =
    Number(caseStatusFilter !== "all") +
    Number(casePriorityFilter !== "all") +
    Number(caseStepFilter !== "all") +
    Number(caseRunFilter !== "all");

  const areAllFilteredCasesSelected =
    filteredCases.length > 0 && filteredCases.every((item) => selectedActionTestCaseIds.includes(item.id));
  const selectedProject = projects.find((project) => project.id === projectId) || null;
  const selectedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;
  const executionsById = useMemo(
    () =>
      executions.reduce<Record<string, Execution>>((map, execution) => {
        map[execution.id] = execution;
        return map;
      }, {}),
    [executions]
  );
  const selectedActionCases = useMemo(
    () => testCases.filter((item) => selectedActionTestCaseIds.includes(item.id)),
    [selectedActionTestCaseIds, testCases]
  );

  const selectedTestCase = useMemo(
    () => testCases.find((item) => item.id === selectedTestCaseId) || null,
    [selectedTestCaseId, testCases]
  );

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (!selectedTestCaseId) {
      setCaseDraft(EMPTY_CASE_DRAFT);
      return;
    }

    if (selectedTestCase) {
      setCaseDraft({
        title: selectedTestCase.title,
        description: selectedTestCase.description || "",
        priority: selectedTestCase.priority ?? 3,
        status: selectedTestCase.status || "active",
        requirement_id: selectedTestCase.requirement_ids?.[0] || selectedTestCase.requirement_id || ""
      });
      return;
    }

    setSelectedTestCaseId("");
    setCaseDraft(EMPTY_CASE_DRAFT);
  }, [isCreating, selectedTestCase, selectedTestCaseId]);

  useEffect(() => {
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setSelectedStepIds([]);
    setExpandedStepIds([]);
    setExpandedStepGroupIds([]);
    setExpandedSections(createDefaultTestCaseSections());
  }, [isCreating, selectedTestCaseId]);

  useEffect(() => {
    setExpandedStepIds((current) => {
      const validIds = current.filter((id) => displaySteps.some((step) => step.id === id));
      return validIds;
    });

    setExpandedStepGroupIds((current) => {
      const validGroupIds = new Set(displaySteps.map((step) => step.group_id).filter(Boolean));
      return current.filter((id) => validGroupIds.has(id));
    });

    setSelectedStepIds((current) => current.filter((id) => displaySteps.some((step) => step.id === id)));
  }, [displaySteps]);

  useEffect(() => {
    if (!isImportModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsImportModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isImportModalOpen]);

  useEffect(() => {
    if (!isAiStudioOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !previewDesignedCases.isPending && !acceptDesignedCases.isPending) {
        setIsAiStudioOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [acceptDesignedCases.isPending, isAiStudioOpen, previewDesignedCases.isPending]);

  const refreshCases = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["global-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["global-test-case-results", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-suites", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-suites"] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] }),
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["design-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["design-suites", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-cases"] })
    ]);
  };

  const refreshSharedGroups = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["shared-step-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["shared-step-groups", appTypeId] })
    ]);
  };

  const resolveStepInsertIndex = (items: Array<{ id: string }>) => {
    if (stepInsertIndex !== null) {
      return Math.max(0, Math.min(stepInsertIndex, items.length));
    }

    if (!selectedStepIds.length) {
      return items.length;
    }

    const selectedIndexSet = new Set(selectedStepIds);
    let lastSelectedIndex = -1;

    items.forEach((step, index) => {
      if (selectedIndexSet.has(step.id)) {
        lastSelectedIndex = index;
      }
    });

    return lastSelectedIndex >= 0 ? lastSelectedIndex + 1 : items.length;
  };

  const isContinuousStepSelection = (items: Array<{ id: string; step_order: number }>, stepIds: string[]) => {
    if (!stepIds.length) {
      return false;
    }

    const selected = items
      .filter((step) => stepIds.includes(step.id))
      .slice()
      .sort((left, right) => left.step_order - right.step_order);

    if (!selected.length) {
      return false;
    }

    return selected.every((step, index) => index === 0 || step.step_order === selected[index - 1].step_order + 1);
  };

  const getInsertionGroupContext = (
    items: Array<Pick<TestStep, "group_id" | "group_name" | "group_kind" | "reusable_group_id">>,
    insertionIndex: number
  ) => {
    const previousStep = items[insertionIndex - 1];
    const nextStep = items[insertionIndex];

    if (!previousStep?.group_id || previousStep.group_id !== nextStep?.group_id) {
      return null;
    }

    return {
      group_id: previousStep.group_id || null,
      group_name: previousStep.group_name || null,
      group_kind: previousStep.group_kind || null,
      reusable_group_id: previousStep.reusable_group_id || null
    };
  };

  const createReusableGroupRecord = async (name: string, selectedSteps: Array<{ action: string | null; expected_result: string | null }>) => {
    if (!appTypeId) {
      throw new Error("Select an app type before creating a reusable step group.");
    }

    const response = await createSharedStepGroup.mutateAsync({
      app_type_id: appTypeId,
      name,
      steps: selectedSteps.map((step, index) => ({
        step_order: index + 1,
        action: step.action || undefined,
        expected_result: step.expected_result || undefined
      }))
    });

    await refreshSharedGroups();
    return response.id;
  };

  const activateStepInsert = (index: number, groupContext: StepInsertionGroupContext | null = null) => {
    setStepInsertIndex(index);
    setStepInsertGroupContext(groupContext);
    setNewStepDraft(EMPTY_STEP_DRAFT);
  };

  const cancelStepInsert = () => {
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setNewStepDraft(EMPTY_STEP_DRAFT);
  };

  const handleSaveCase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      if (isCreating) {
        const response = await createTestCase.mutateAsync({
          app_type_id: appTypeId,
          title: caseDraft.title,
          description: caseDraft.description || undefined,
          priority: Number(caseDraft.priority),
          status: caseDraft.status,
          requirement_ids: caseDraft.requirement_id ? [caseDraft.requirement_id] : [],
          suite_ids: [],
          steps: normalizeDraftSteps(draftSteps)
        });

        setSelectedTestCaseId(response.id);
        setIsCreating(false);
        setDraftSteps([]);
        setSelectedStepIds([]);
        setStepInsertIndex(null);
        setStepInsertGroupContext(null);
        showSuccess("Test case created with its draft steps.");
      } else if (selectedTestCase) {
        await updateTestCase.mutateAsync({
          id: selectedTestCase.id,
          input: {
            app_type_id: appTypeId,
            title: caseDraft.title,
            description: caseDraft.description,
            priority: Number(caseDraft.priority),
            status: caseDraft.status,
            requirement_ids: caseDraft.requirement_id ? [caseDraft.requirement_id] : []
          }
        });

        showSuccess("Test case updated.");
      }

      await refreshCases();
    } catch (error) {
      showError(error, "Unable to save test case");
    }
  };

  const handleDeleteCase = async () => {
    if (!selectedTestCase || !window.confirm(`Delete test case "${selectedTestCase.title}"? Historical execution evidence will stay preserved.`)) {
      return;
    }

    try {
      await deleteTestCase.mutateAsync(selectedTestCase.id);
      setSelectedActionTestCaseIds((current) => current.filter((id) => id !== selectedTestCase.id));
      setSelectedTestCaseId("");
      setCaseDraft(EMPTY_CASE_DRAFT);
      setIsCreating(false);
      setSelectedStepIds([]);
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      showSuccess("Test case deleted. Execution snapshots remain available.");
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to delete test case");
    }
  };

  const handleDeleteSelectedCases = async () => {
    const selectedCases = testCases.filter((item) => selectedActionTestCaseIds.includes(item.id));

    if (!selectedCases.length) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedCases.length} test case${selectedCases.length === 1 ? "" : "s"}? Historical execution evidence will stay preserved.`
    );

    if (!confirmed) {
      return;
    }

    setIsDeletingSelectedTestCases(true);

    try {
      const results = await Promise.allSettled(selectedCases.map((testCase) => api.testCases.delete(testCase.id)));
      const deletedIds = selectedCases
        .filter((_, index) => results[index]?.status === "fulfilled")
        .map((testCase) => testCase.id);
      const failedResults = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

      setSelectedActionTestCaseIds((current) => current.filter((id) => !deletedIds.includes(id)));

      if (deletedIds.includes(selectedTestCaseId)) {
        setSelectedTestCaseId("");
        setCaseDraft(EMPTY_CASE_DRAFT);
        setDraftSteps([]);
        setNewStepDraft(EMPTY_STEP_DRAFT);
        setStepInsertIndex(null);
        setStepInsertGroupContext(null);
        setSelectedStepIds([]);
        setExpandedStepIds([]);
        setExpandedStepGroupIds([]);
        setIsCreating(false);
      }

      if (deletedIds.length) {
        await refreshCases();
      }

      if (!failedResults.length) {
        showSuccess(`${deletedIds.length} test case${deletedIds.length === 1 ? "" : "s"} deleted. Execution history remains preserved.`);
        return;
      }

      const firstError = failedResults[0]?.reason;
      setMessageTone("error");
      setMessage(
        `${deletedIds.length} test case${deletedIds.length === 1 ? "" : "s"} deleted, ${failedResults.length} failed.${firstError instanceof Error ? ` ${firstError.message}` : ""}`
      );
    } finally {
      setIsDeletingSelectedTestCases(false);
    }
  };

  const handleCreateSuite = async (input: { name: string; parent_id?: string; selectedIds: string[] }) => {
    if (!appTypeId) {
      setMessageTone("error");
      setMessage("Select an app type before creating a suite.");
      return;
    }

    try {
      const response = await createSuite.mutateAsync({
        app_type_id: appTypeId,
        name: input.name,
        parent_id: input.parent_id || undefined
      });

      if (input.selectedIds.length) {
        await assignSuiteCases.mutateAsync({
          id: response.id,
          testCaseIds: input.selectedIds
        });
      }

      setIsCreateSuiteModalOpen(false);
      setSelectedActionTestCaseIds([]);
      showSuccess(input.selectedIds.length ? "Suite created and linked to the selected test cases." : "Suite created.");
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to create suite");
    }
  };

  const handleCreateExecution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session?.user.id) {
      setMessageTone("error");
      setMessage("You need an active session before creating an execution.");
      return;
    }

    if (!projectId || !appTypeId || !selectedActionTestCaseIds.length) {
      setMessageTone("error");
      setMessage("Select one or more test cases before creating an execution.");
      return;
    }

    try {
      const response = await createExecution.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId,
        test_case_ids: selectedActionTestCaseIds,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined,
        name: executionName.trim() || undefined,
        created_by: session.user.id
      });

      closeCreateExecutionModal();
      setSelectedActionTestCaseIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["executions"] }),
        queryClient.invalidateQueries({ queryKey: ["executions", projectId] })
      ]);
      navigate(`/executions?execution=${response.id}`);
    } catch (error) {
      showError(error, "Unable to create execution");
    }
  };

  const openExecutionHistoryResult = (result: ExecutionResult) => {
    const params = new URLSearchParams({
      execution: result.execution_id,
      testCase: result.test_case_id
    });

    navigate(`/executions?${params.toString()}`);
  };

  const handleCreateStep = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedDraft = {
      action: newStepDraft.action.trim(),
      expected_result: newStepDraft.expected_result.trim()
    };

    if (!normalizedDraft.action && !normalizedDraft.expected_result) {
      setMessageTone("error");
      setMessage("Add an action or expected result before creating a step.");
      return;
    }

    if (isCreating) {
      const draftId = createDraftStepId();
      const insertionIndex = resolveStepInsertIndex(draftSteps);
      const insertionGroupContext =
        stepInsertIndex !== null && stepInsertGroupContext
          ? stepInsertGroupContext
          : getInsertionGroupContext(displaySteps, insertionIndex);

      setDraftSteps((current) => {
        const next = [...current];
        next.splice(insertionIndex, 0, {
          id: draftId,
          ...normalizedDraft,
          group_id: insertionGroupContext?.group_id || null,
          group_name: insertionGroupContext?.group_name || null,
          group_kind: insertionGroupContext?.group_kind || null,
          reusable_group_id: insertionGroupContext?.reusable_group_id || null
        });
        return next;
      });
      setExpandedStepIds((current) => [...new Set([...current, draftId])]);
      setSelectedStepIds([draftId]);
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      showSuccess("Draft step added to the new test case.");
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      const insertionIndex = resolveStepInsertIndex(steps);
      const insertionGroupContext =
        stepInsertIndex !== null && stepInsertGroupContext
          ? stepInsertGroupContext
          : getInsertionGroupContext(displaySteps, insertionIndex);
      const nextStepOrder = insertionIndex + 1;
      const response = await createStep.mutateAsync({
        test_case_id: selectedTestCaseId,
        step_order: nextStepOrder,
        action: normalizedDraft.action || undefined,
        expected_result: normalizedDraft.expected_result || undefined,
        group_id: insertionGroupContext?.group_id || undefined,
        group_name: insertionGroupContext?.group_name || undefined,
        group_kind: insertionGroupContext?.group_kind || undefined,
        reusable_group_id: insertionGroupContext?.reusable_group_id || undefined
      });
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      setExpandedStepIds((current) => [...new Set([...current, response.id])]);
      setSelectedStepIds([response.id]);
      showSuccess("Step added.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      showError(error, "Unable to add step");
    }
  };

  useEffect(() => {
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
  }, [isCreating, selectedTestCaseId]);

  const handleUpdateStep = async (step: TestStep, input: StepDraft) => {
    try {
      await updateStep.mutateAsync({
        id: step.id,
        input: {
          action: input.action,
          expected_result: input.expected_result
        }
      });
      showSuccess("Step updated.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      showError(error, "Unable to update step");
    }
  };

  const handleReorderStep = async (stepId: string, direction: "up" | "down") => {
    if (!selectedTestCaseId) {
      return;
    }

    const currentIndex = steps.findIndex((step) => step.id === stepId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= steps.length) {
      return;
    }

    const reordered = [...steps];
    const [movedStep] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, movedStep);

    try {
      await reorderSteps.mutateAsync({
        testCaseId: selectedTestCaseId,
        stepIds: reordered.map((step) => step.id)
      });
      showSuccess("Step order updated.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      showError(error, "Unable to reorder steps");
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (isCreating) {
      setDraftSteps((current) => current.filter((step) => step.id !== stepId));
      setSelectedStepIds((current) => current.filter((id) => id !== stepId));
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Draft step removed.");
      return;
    }

    if (!window.confirm("Delete this step?")) {
      return;
    }

    try {
      await deleteStep.mutateAsync(stepId);
      setSelectedStepIds((current) => current.filter((id) => id !== stepId));
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Step deleted.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      showError(error, "Unable to delete step");
    }
  };

  const handleDeleteSelectedSteps = async () => {
    const targetIds = selectedStepIds.filter((id) => displaySteps.some((step) => step.id === id));

    if (!targetIds.length) {
      showError(new Error("Select one or more steps to delete."), "Unable to delete selected steps");
      return;
    }

    const countLabel = `${targetIds.length} selected step${targetIds.length === 1 ? "" : "s"}`;

    if (!window.confirm(`Delete ${countLabel}?`)) {
      return;
    }

    if (isCreating) {
      setDraftSteps((current) => current.filter((step) => !targetIds.includes(step.id)));
      setSelectedStepIds([]);
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      cancelStepInsert();
      showSuccess(`${countLabel} deleted.`);
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      await Promise.all(targetIds.map((stepId) => deleteStep.mutateAsync(stepId)));
      setSelectedStepIds([]);
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      cancelStepInsert();
      showSuccess(`${countLabel} deleted.`);
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      showError(error, "Unable to delete selected steps");
    }
  };

  const handleUpdateDraftStep = (stepId: string, input: StepDraft) => {
    setDraftSteps((current) =>
      current.map((step) =>
        step.id === stepId
          ? {
              ...step,
              action: input.action,
              expected_result: input.expected_result
            }
          : step
      )
    );
  };

  const handleReorderDraftStep = (stepId: string, direction: "up" | "down") => {
    setDraftSteps((current) => {
      const currentIndex = current.findIndex((step) => step.id === stepId);
      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

      if (currentIndex === -1 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const reordered = [...current];
      const [movedStep] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, movedStep);
      return reordered;
    });
    showSuccess("Draft step order updated.");
  };

  const handleCopySteps = (stepIds?: string[]) => {
    const targetIds = (stepIds && stepIds.length ? stepIds : selectedStepIds).filter(Boolean);

    if (!targetIds.length) {
      showError(new Error("Select one or more steps to copy."), "Unable to copy steps");
      return;
    }

    const orderedSelection = displaySteps.filter((step) => targetIds.includes(step.id));

    if (!orderedSelection.length) {
      return;
    }

    setCopiedSteps(normalizeCopiedSteps(orderedSelection));
    setCopiedStepMode("copy");
    setCutStepSource(null);
    showSuccess(`${orderedSelection.length} step${orderedSelection.length === 1 ? "" : "s"} copied. Use paste to insert them where you want.`);
  };

  const handleCutSteps = (stepIds?: string[]) => {
    const targetIds = (stepIds && stepIds.length ? stepIds : selectedStepIds).filter(Boolean);

    if (!targetIds.length) {
      showError(new Error("Select one or more steps to cut."), "Unable to cut steps");
      return;
    }

    const orderedSelection = displaySteps.filter((step) => targetIds.includes(step.id));

    if (!orderedSelection.length) {
      return;
    }

    setCopiedSteps(normalizeCopiedSteps(orderedSelection));
    setCopiedStepMode("cut");
    setCutStepSource({
      stepIds: orderedSelection.map((step) => step.id),
      testCaseId: isCreating ? null : selectedTestCaseId,
      isDraft: isCreating
    });
    showSuccess(`${orderedSelection.length} step${orderedSelection.length === 1 ? "" : "s"} cut. Paste to move ${orderedSelection.length === 1 ? "it" : "them"} into place.`);
  };

  const handlePasteSteps = async (targetIndex?: number, groupContext?: StepInsertionGroupContext | null) => {
    if (!copiedSteps.length) {
      showError(new Error("Copy one or more steps before pasting."), "Unable to paste steps");
      return;
    }

    const materialized = materializeCopiedSteps(copiedSteps);
    const insertionIndex = targetIndex ?? resolveStepInsertIndex(displaySteps);
    const insertionGroupContext = groupContext || getInsertionGroupContext(displaySteps, insertionIndex);
    const stepsToPaste =
      insertionGroupContext && materialized.every((step) => !step.group_id)
        ? materialized.map((step) => ({
            ...step,
            group_id: insertionGroupContext.group_id,
            group_name: insertionGroupContext.group_name,
            group_kind: insertionGroupContext.group_kind,
            reusable_group_id: insertionGroupContext.reusable_group_id
          }))
        : materialized;

    try {
      if (isCreating) {
        const pastedDraftSteps = stepsToPaste.map((step) => ({
          ...step,
          id: createDraftStepId()
        }));

        setDraftSteps((current) => {
          const next = [...current];
          next.splice(insertionIndex, 0, ...pastedDraftSteps);
          return next;
        });
        setExpandedStepIds((current) => [...new Set([...current, ...pastedDraftSteps.map((step) => step.id)])]);
        setSelectedStepIds(pastedDraftSteps.map((step) => step.id));
      } else if (selectedTestCaseId) {
        const createdStepIds: string[] = [];

        for (const [offset, step] of stepsToPaste.entries()) {
          const response = await createStep.mutateAsync({
            test_case_id: selectedTestCaseId,
            step_order: insertionIndex + offset + 1,
            action: step.action || undefined,
            expected_result: step.expected_result || undefined,
            group_id: step.group_id || undefined,
            group_name: step.group_name || undefined,
            group_kind: step.group_kind || undefined,
            reusable_group_id: step.reusable_group_id || undefined
          });
          createdStepIds.push(response.id);
        }

        setExpandedStepIds((current) => [...new Set([...current, ...createdStepIds])]);
        setSelectedStepIds(createdStepIds);
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      }

      if (copiedStepMode === "cut" && cutStepSource?.stepIds.length) {
        if (cutStepSource.isDraft) {
          setDraftSteps((current) => current.filter((step) => !cutStepSource.stepIds.includes(step.id)));
        } else {
          await Promise.all(cutStepSource.stepIds.map((stepId) => deleteStep.mutateAsync(stepId)));

          if (cutStepSource.testCaseId && cutStepSource.testCaseId !== selectedTestCaseId) {
            await queryClient.invalidateQueries({ queryKey: ["test-case-steps", cutStepSource.testCaseId] });
          }

          if (selectedTestCaseId) {
            await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
          }
        }

        setExpandedStepIds((current) => current.filter((id) => !cutStepSource.stepIds.includes(id)));
        setCopiedSteps([]);
        setCopiedStepMode("copy");
        setCutStepSource(null);
      }

      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      showSuccess(`${copiedStepMode === "cut" ? "Moved" : "Pasted"} ${stepsToPaste.length} step${stepsToPaste.length === 1 ? "" : "s"}.`);
    } catch (error) {
      showError(error, "Unable to paste steps");
    }
  };

  const handleOpenStepGroupModal = () => {
    if (!selectedStepIds.length) {
      showError(new Error("Select one or more steps to group."), "Unable to group steps");
      return;
    }

    if (!isContinuousStepSelection(displaySteps, selectedStepIds)) {
      showError(new Error("Select a continuous step range before grouping."), "Unable to group steps");
      return;
    }

    setStepGroupName("");
    setSaveAsReusableGroup(false);
    setIsStepGroupModalOpen(true);
  };

  const handleConfirmStepGroup = async () => {
    const name = stepGroupName.trim();

    if (!name) {
      showError(new Error("Enter a group name before saving the step group."), "Unable to group steps");
      return;
    }

    const selectedStepsForGrouping = displaySteps.filter((step) => selectedStepIds.includes(step.id));

    if (!selectedStepsForGrouping.length) {
      return;
    }

    try {
      const reusableGroupId = saveAsReusableGroup
        ? await createReusableGroupRecord(
            name,
            selectedStepsForGrouping.map((step) => ({
              action: step.action,
              expected_result: step.expected_result
            }))
          )
        : null;

      if (isCreating) {
        const groupId = createDraftGroupId();

        setDraftSteps((current) =>
          current.map((step) =>
            selectedStepIds.includes(step.id)
              ? {
                  ...step,
                  group_id: groupId,
                  group_name: name,
                  group_kind: saveAsReusableGroup ? "reusable" : "local",
                  reusable_group_id: reusableGroupId
                }
              : step
          )
        );
      } else if (selectedTestCaseId) {
        await groupSteps.mutateAsync({
          test_case_id: selectedTestCaseId,
          step_ids: selectedStepIds,
          name,
          kind: saveAsReusableGroup ? "reusable" : "local",
          reusable_group_id: reusableGroupId || undefined
        });
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      }

      if (reusableGroupId) {
        await refreshSharedGroups();
      }

      setIsStepGroupModalOpen(false);
      setStepGroupName("");
      setSaveAsReusableGroup(false);
      showSuccess(saveAsReusableGroup ? "Reusable step group created." : "Step group created.");
    } catch (error) {
      showError(error, "Unable to group steps");
    }
  };

  const handleUngroupStepGroup = async (groupId: string, kind?: TestStep["group_kind"]) => {
    const successMessage =
      kind === "reusable"
        ? "Shared group unlinked from this test case. Steps stayed in place."
        : "Step group removed. Steps stayed in place.";

    if (isCreating) {
      setDraftSteps((current) =>
        current.map((step) =>
          step.group_id === groupId
            ? {
                ...step,
                group_id: null,
                group_name: null,
                group_kind: null,
                reusable_group_id: null
              }
            : step
        )
      );
      cancelStepInsert();
      showSuccess(successMessage);
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      await ungroupSteps.mutateAsync({
        test_case_id: selectedTestCaseId,
        group_id: groupId
      });
      cancelStepInsert();
      showSuccess(successMessage);
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      showError(error, "Unable to ungroup steps");
    }
  };

  const handleRemoveStepGroup = async (groupId: string, groupSteps: TestStep[], kind?: TestStep["group_kind"]) => {
    const targetIds = groupSteps.map((step) => step.id);

    if (!targetIds.length) {
      return;
    }

    const groupName = groupSteps[0]?.group_name || "this step group";
    const isSharedGroup = kind === "reusable";
    const confirmMessage = isSharedGroup
      ? `Remove shared group "${groupName}" from this test case? The shared group library item will stay available.`
      : `Delete "${groupName}" and its ${targetIds.length} step${targetIds.length === 1 ? "" : "s"}?`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    if (isCreating) {
      setDraftSteps((current) => current.filter((step) => step.group_id !== groupId));
      setSelectedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      setExpandedStepGroupIds((current) => current.filter((id) => id !== groupId));
      cancelStepInsert();
      showSuccess(isSharedGroup ? "Shared group removed from this draft case." : "Step group and its steps removed.");
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      await Promise.all(targetIds.map((stepId) => deleteStep.mutateAsync(stepId)));
      setSelectedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      setExpandedStepGroupIds((current) => current.filter((id) => id !== groupId));
      cancelStepInsert();
      showSuccess(isSharedGroup ? "Shared group removed from this test case." : "Step group and its steps removed.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      showError(error, "Unable to remove step group");
    }
  };

  const handleInsertSharedGroup = async () => {
    const sharedGroup = sharedStepGroups.find((group) => group.id === selectedSharedGroupId);

    if (!sharedGroup) {
      showError(new Error("Choose a shared step group to insert."), "Unable to insert shared group");
      return;
    }

    try {
      if (isCreating) {
        const insertionIndex = resolveStepInsertIndex(draftSteps);
        const groupInstanceId = createDraftGroupId();
        const insertedSteps = sharedGroup.steps.map((step) => ({
          id: createDraftStepId(),
          action: step.action || "",
          expected_result: step.expected_result || "",
          group_id: groupInstanceId,
          group_name: sharedGroup.name,
          group_kind: "reusable" as const,
          reusable_group_id: sharedGroup.id
        }));

        setDraftSteps((current) => {
          const next = [...current];
          next.splice(insertionIndex, 0, ...insertedSteps);
          return next;
        });
        setExpandedStepIds((current) => [...new Set([...current, ...insertedSteps.map((step) => step.id)])]);
        setSelectedStepIds(insertedSteps.map((step) => step.id));
      } else if (selectedTestCaseId) {
        const insertionIndex = resolveStepInsertIndex(steps);
        const insertAfterStepId = insertionIndex > 0 ? steps[insertionIndex - 1]?.id : undefined;

        await insertSharedGroup.mutateAsync({
          test_case_id: selectedTestCaseId,
          shared_step_group_id: sharedGroup.id,
          insert_after_step_id: insertAfterStepId
        });
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      }

      setIsSharedGroupPickerOpen(false);
      setSelectedSharedGroupId("");
      setSharedGroupSearchTerm("");
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      showSuccess(`Inserted shared group "${sharedGroup.name}".`);
    } catch (error) {
      showError(error, "Unable to insert shared group");
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseTestCaseCsv(text);

      setImportRows(parsed.rows);
      setImportWarnings(parsed.warnings);
      setImportFileName(file.name);
      setMessageTone(parsed.rows.length ? "success" : "error");
      setMessage(
        parsed.rows.length
          ? `Prepared ${parsed.rows.length} test cases from ${file.name}.`
          : parsed.warnings[0] || "No test cases could be parsed from the CSV file."
      );
    } catch (error) {
      showError(error, "Unable to read the CSV file");
    } finally {
      event.target.value = "";
    }
  };

  const handleBulkImport = async () => {
    if (!appTypeId || !importRows.length) {
      return;
    }

    try {
      const response = await importTestCases.mutateAsync({
        app_type_id: appTypeId,
        requirement_id: importRequirementId || undefined,
        rows: importRows
      });

      setMessageTone(response.failed ? "error" : "success");
      setMessage(
        response.failed
          ? `${response.imported} test cases imported, ${response.failed} rows skipped.`
          : `${response.imported} test cases imported successfully.`
      );
      setImportWarnings(response.errors.map((item) => `Row ${item.row}: ${item.message}`));
      setImportRows([]);
      setImportFileName("");
      if (response.created[0]) {
        setSelectedTestCaseId(response.created[0].id);
      }
      if (!response.failed) {
        setIsImportModalOpen(false);
      }
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to import test cases");
    }
  };

  const handleExportCsv = async () => {
    if (!filteredCases.length) {
      setMessageTone("error");
      setMessage("No test cases match the current scope to export.");
      return;
    }

    try {
      const allSteps = await api.testSteps.list();
      const stepsByCaseId = allSteps.reduce<Record<string, TestStep[]>>((accumulator, step) => {
        accumulator[step.test_case_id] = accumulator[step.test_case_id] || [];
        accumulator[step.test_case_id].push(step);
        return accumulator;
      }, {});

      Object.values(stepsByCaseId).forEach((items) => items.sort((left, right) => left.step_order - right.step_order));

      const header = ["title", "description", "priority", "status", "requirement", "suites", "action", "expected_result", "step_group_name", "step_group_kind", "shared_group_id"];
      const rows = filteredCases.map((testCase) => {
        const requirement = requirements.find((item) => (testCase.requirement_ids || [testCase.requirement_id]).includes(item.id));
        const suiteCount = (testCase.suite_ids || []).length;
        const scopedSteps = stepsByCaseId[testCase.id] || [];

        return [
          testCase.title,
          testCase.description || "",
          `P${testCase.priority || 3}`,
          testCase.status || "active",
          requirement?.title || "",
          suiteCount ? `${suiteCount} suite${suiteCount === 1 ? "" : "s"}` : "",
          scopedSteps.map((step) => step.action || "").join("\n"),
          scopedSteps.map((step) => step.expected_result || "").join("\n"),
          scopedSteps.map((step) => step.group_name || "").join("\n"),
          scopedSteps.map((step) => step.group_kind || "").join("\n"),
          scopedSteps.map((step) => step.reusable_group_id || "").join("\n")
        ];
      });

      const csv = [header, ...rows].map((row) => row.map((value) => toCsvCell(value)).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const appTypeName = appTypes.find((item) => item.id === appTypeId)?.name || "library";

      link.href = href;
      link.download = `${appTypeName.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}-test-cases.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      showSuccess(`Exported ${filteredCases.length} test cases to CSV with step groups preserved.`);
    } catch (error) {
      showError(error, "Unable to export test cases");
    }
  };

  const openAiStudio = () => {
    const seededRequirementIds = [
      ...(selectedTestCase?.requirement_ids || []),
      ...(selectedTestCase?.requirement_id ? [selectedTestCase.requirement_id] : []),
      ...(caseDraft.requirement_id ? [caseDraft.requirement_id] : [])
    ].filter(Boolean);

    setAiRequirementIds(seededRequirementIds.length ? [...new Set(seededRequirementIds)] : requirements[0] ? [requirements[0].id] : []);
    setAiPreviewCases([]);
    setAiPreviewMessage("");
    setAiPreviewTone("success");
    setIsAiStudioOpen(true);
  };

  const handleAddAiReferenceImages = async (files: FileList | null) => {
    try {
      const images = await readImageFiles(files);
      setAiReferenceImages((current) => appendUniqueImages(current, images));
    } catch (error) {
      setAiPreviewTone("error");
      setAiPreviewMessage(error instanceof Error ? error.message : "Unable to attach the selected image");
    }
  };

  const handlePreviewDesignedCases = async () => {
    if (!appTypeId || !aiRequirementIds.length) {
      return;
    }

    try {
      const response = await previewDesignedCases.mutateAsync({
        app_type_id: appTypeId,
        requirement_ids: aiRequirementIds,
        integration_id: integrationId || undefined,
        max_cases: maxCases,
        additional_context: aiAdditionalContext || undefined,
        external_links: parseExternalLinks(aiExternalLinksText),
        images: aiReferenceImages
      });

      setAiPreviewCases(response.cases);
      setAiPreviewTone("success");
      setAiPreviewMessage(`${response.generated} draft cases generated using ${response.integration.name}. Review them before accepting.`);
    } catch (error) {
      setAiPreviewTone("error");
      setAiPreviewMessage(error instanceof Error ? error.message : "Unable to preview AI-generated test cases");
    }
  };

  const handleAcceptDesignedCases = async () => {
    if (!appTypeId || !aiRequirementIds.length || !aiPreviewCases.length) {
      return;
    }

    try {
      const response = await acceptDesignedCases.mutateAsync({
        app_type_id: appTypeId,
        requirement_ids: aiRequirementIds,
        status: "draft",
        cases: aiPreviewCases.map((item) => ({
          title: item.title,
          description: item.description,
          priority: item.priority,
          requirement_ids: item.requirement_ids,
          steps: item.steps.map((step) => ({
            step_order: step.step_order,
            action: step.action,
            expected_result: step.expected_result
          }))
        }))
      });

      setAiPreviewCases([]);
      setAiPreviewMessage("");
      setIsAiStudioOpen(false);
      if (response.created[0]) {
        setSelectedTestCaseId(response.created[0].id);
        setIsCreating(false);
      }
      showSuccess("AI-designed test cases accepted into the library as standard steps.");
      await refreshCases();
    } catch (error) {
      setAiPreviewTone("error");
      setAiPreviewMessage(error instanceof Error ? error.message : "Unable to accept AI-generated test cases");
    }
  };

  const coverageMetrics = useMemo(() => {
    const covered = testCases.filter((testCase) => (testCase.requirement_ids || [testCase.requirement_id]).filter(Boolean).length).length;
    const withHistory = testCases.filter((testCase) => (historyByCaseId[testCase.id] || []).length).length;
    const withSuites = testCases.filter((testCase) => (testCase.suite_ids || []).length).length;

    return {
      total: testCases.length,
      covered,
      withHistory,
      withSuites
    };
  }, [historyByCaseId, testCases]);
  const importStepCount = useMemo(
    () => importRows.reduce((total, row) => total + countImportedSteps(row), 0),
    [importRows]
  );
  const isLibraryLoading = testCasesQuery.isLoading || executionResultsQuery.isLoading || allTestStepsQuery.isLoading;

  const selectedRequirement = requirements.find((item) => item.id === caseDraft.requirement_id) || null;
  const selectedHistory = selectedTestCase ? historyByCaseId[selectedTestCase.id] || [] : [];
  const selectedEditorSteps = useMemo(
    () => displaySteps.filter((step) => selectedStepIds.includes(step.id)),
    [displaySteps, selectedStepIds]
  );
  const stepBlocks = useMemo(() => {
    return displaySteps.reduce<Array<{
      key: string;
      group_id: string | null;
      group_name: string | null;
      group_kind: TestStep["group_kind"];
      reusable_group_id: string | null;
      steps: TestStep[];
    }>>((blocks, step) => {
      const previousBlock = blocks[blocks.length - 1];

      if (step.group_id && previousBlock?.group_id === step.group_id) {
        previousBlock.steps.push(step);
        return blocks;
      }

      blocks.push({
        key: step.group_id ? `group-${step.group_id}` : `step-${step.id}`,
        group_id: step.group_id || null,
        group_name: step.group_name || null,
        group_kind: step.group_kind || null,
        reusable_group_id: step.reusable_group_id || null,
        steps: [step]
      });

      return blocks;
    }, []);
  }, [displaySteps]);
  const stepGroupIds = useMemo(
    () => [...new Set(stepBlocks.map((block) => block.group_id).filter((groupId): groupId is string => Boolean(groupId)))],
    [stepBlocks]
  );
  const filteredSharedGroups = useMemo(() => {
    const search = sharedGroupSearchTerm.trim().toLowerCase();

    return sharedStepGroups.filter((group) => {
      if (!search) {
        return true;
      }

      return [group.name, group.description || "", ...group.steps.map((step) => `${step.action || ""} ${step.expected_result || ""}`)]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [sharedGroupSearchTerm, sharedStepGroups]);
  const selectedSharedGroup = sharedStepGroups.find((group) => group.id === selectedSharedGroupId) || null;
  const isCaseWorkspaceOpen = Boolean(selectedTestCaseId) || isCreating;
  const stepCountLabel = `${displaySteps.length} step${displaySteps.length === 1 ? "" : "s"}`;
  const firstStepPreview = displaySteps[0]?.action || displaySteps[0]?.expected_result || "";
  const caseSectionSummary = isCreating
    ? caseDraft.title.trim() || "Start defining the reusable case before saving it."
    : selectedTestCase?.title || "Select a test case from the library to edit it here.";
  const stepSectionSummary = firstStepPreview
    ? `Starts with: ${firstStepPreview}`
    : isCreating
      ? "No draft steps added yet."
      : "No steps added yet for this test case.";
  const historySectionSummary = selectedHistory.length
    ? "Review the latest recorded outcomes and preserved execution evidence for this reusable test case."
    : "No execution history has been recorded for this reusable test case yet.";
  const aiSelectedRequirements = useMemo(
    () => requirements.filter((requirement) => aiRequirementIds.includes(requirement.id)),
    [aiRequirementIds, requirements]
  );
  const aiExistingCases = useMemo(() => {
    if (!aiRequirementIds.length) {
      return [];
    }

    const requirementSet = new Set(aiRequirementIds);
    return testCases.filter((testCase) =>
      (testCase.requirement_ids || [testCase.requirement_id]).filter(Boolean).some((requirementId) => requirementSet.has(requirementId as string))
    );
  }, [aiRequirementIds, testCases]);

  const closeCaseWorkspace = () => {
    setIsCreating(false);
    setSelectedTestCaseId("");
    setCaseDraft(EMPTY_CASE_DRAFT);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setDraftSteps([]);
    setSelectedStepIds([]);
    setExpandedStepIds([]);
    setExpandedStepGroupIds([]);
    setExpandedSections(createDefaultTestCaseSections());
    setIsStepGroupModalOpen(false);
    setStepGroupName("");
    setSaveAsReusableGroup(false);
    setIsSharedGroupPickerOpen(false);
    setSelectedSharedGroupId("");
    setSharedGroupSearchTerm("");
  };

  const isMatchingStepInsertContext = (groupContext: StepInsertionGroupContext | null = null) =>
    (stepInsertGroupContext?.group_id || null) === (groupContext?.group_id || null);

  const renderStepInsertSlot = (index: number, groupContext: StepInsertionGroupContext | null = null, isVisibleByDefault = false) => (
    <InlineStepInsertSlot
      canPaste={Boolean(copiedSteps.length)}
      draft={newStepDraft}
      index={index}
      isActive={stepInsertIndex === index && isMatchingStepInsertContext(groupContext)}
      isVisibleByDefault={isVisibleByDefault}
      onActivate={() => activateStepInsert(index, groupContext)}
      onCancel={cancelStepInsert}
      onChange={setNewStepDraft}
      onPaste={() => void handlePasteSteps(index, groupContext)}
      onSubmit={(event) => void handleCreateStep(event)}
    />
  );

  const renderStepCard = (step: TestStep, index: number, groupContext: StepInsertionGroupContext | null = null) => {
    const insertAboveIndex = Math.max(0, step.step_order - 1);
    const insertBelowIndex = step.step_order;

    if (isCreating) {
      return (
        <DraftStepCard
          canPaste={Boolean(copiedSteps.length)}
          canMoveDown={index < displaySteps.length - 1}
          canMoveUp={index > 0}
          isSelected={selectedStepIds.includes(step.id)}
          onChange={(input) => handleUpdateDraftStep(step.id, input)}
          onCopy={() => handleCopySteps([step.id])}
          onCut={() => handleCutSteps([step.id])}
          onDelete={() => void handleDeleteStep(step.id)}
          onInsertAbove={() => activateStepInsert(insertAboveIndex, groupContext)}
          onInsertBelow={() => activateStepInsert(insertBelowIndex, groupContext)}
          onMoveDown={() => handleReorderDraftStep(step.id, "down")}
          onMoveUp={() => handleReorderDraftStep(step.id, "up")}
          onPasteAbove={() => void handlePasteSteps(insertAboveIndex, groupContext)}
          onPasteBelow={() => void handlePasteSteps(insertBelowIndex, groupContext)}
          onToggleSelect={(checked) =>
            setSelectedStepIds((current) =>
              checked ? [...new Set([...current, step.id])] : current.filter((id) => id !== step.id)
            )
          }
          step={{
            id: step.id,
            step_order: step.step_order,
            action: step.action || "",
            expected_result: step.expected_result || "",
            group_id: step.group_id || null,
            group_name: step.group_name || null,
            group_kind: step.group_kind || null,
            reusable_group_id: step.reusable_group_id || null
          }}
        />
      );
    }

    return (
      <EditableStepCard
        canPaste={Boolean(copiedSteps.length)}
        canMoveDown={index < displaySteps.length - 1}
        canMoveUp={index > 0}
        isExpanded={expandedStepIds.includes(step.id)}
        isSelected={selectedStepIds.includes(step.id)}
        onCopy={() => handleCopySteps([step.id])}
        onCut={() => handleCutSteps([step.id])}
        onDelete={() => void handleDeleteStep(step.id)}
        onInsertAbove={() => activateStepInsert(insertAboveIndex, groupContext)}
        onInsertBelow={() => activateStepInsert(insertBelowIndex, groupContext)}
        onMoveDown={() => void handleReorderStep(step.id, "down")}
        onMoveUp={() => void handleReorderStep(step.id, "up")}
        onPasteAbove={() => void handlePasteSteps(insertAboveIndex, groupContext)}
        onPasteBelow={() => void handlePasteSteps(insertBelowIndex, groupContext)}
        onSave={(input) => void handleUpdateStep(step, input)}
        onToggle={() =>
          setExpandedStepIds((current) =>
            current.includes(step.id) ? current.filter((id) => id !== step.id) : [...current, step.id]
          )
        }
        onToggleSelect={(checked) =>
          setSelectedStepIds((current) =>
            checked ? [...new Set([...current, step.id])] : current.filter((id) => id !== step.id)
          )
        }
        step={step}
      />
    );
  };

  return (
    <div className={["page-content", "page-content--library-full", isCaseWorkspaceOpen ? "page-content--workspace-focus" : ""].join(" ")}>
      {!isCaseWorkspaceOpen ? (
        <PageHeader
          eyebrow="Test Cases"
          title="Test Case Library"
          description="Build reusable coverage with clean step detail, requirement traceability, suite linkage, and execution-ready exports."
          meta={[
            { label: "Cases", value: coverageMetrics.total },
            { label: "Mapped", value: coverageMetrics.covered },
            { label: "With history", value: coverageMetrics.withHistory }
          ]}
          actions={
            <>
              <button className="ghost-button" disabled={!appTypeId} onClick={() => setIsImportModalOpen(true)} type="button">
                Bulk Import
              </button>
              <button className="ghost-button" disabled={!requirements.length || !appTypeId} onClick={openAiStudio} type="button">
                AI Test Case Generation
              </button>
              <button className="ghost-button" disabled={!filteredCases.length} onClick={() => void handleExportCsv()} type="button">
                Export CSV
              </button>
              <button className="primary-button" disabled={!appTypeId} onClick={beginCreateCase} type="button">
                New Test Case
              </button>
            </>
          }
        />
      ) : null}

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      {!isCaseWorkspaceOpen ? (
        <WorkspaceScopeBar
          appTypeId={appTypeId}
          appTypes={appTypes}
          onAppTypeChange={(value) => {
            setAppTypeId(value);
            resetExecutionContextSelection();
          }}
          onProjectChange={(value) => {
            setProjectId(value);
            setAppTypeId("");
            resetExecutionContextSelection();
          }}
          projectId={projectId}
          projects={projects}
        />
      ) : null}

      <WorkspaceMasterDetail
        browseView={(
          <Panel title="Test case tiles" subtitle={appTypeId ? "Browse reusable coverage as cards first, then open one case into a full-page editor." : "Choose an app type to begin."}>
            <div className="design-list-toolbar test-case-catalog-toolbar">
              <CatalogSearchFilter
                activeFilterCount={activeCaseFilterCount}
                ariaLabel="Search test cases"
                onChange={setSearchTerm}
                placeholder="Search title, description, or requirement"
                subtitle="Filter the case tiles by the status and facts shown on each card."
                title="Filter test cases"
                value={searchTerm}
              >
                <div className="catalog-filter-grid">
                  <label className="catalog-filter-field">
                    <span>Status</span>
                    <select value={caseStatusFilter} onChange={(event) => setCaseStatusFilter(event.target.value)}>
                      <option value="all">All statuses</option>
                      {caseStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {formatTileCardLabel(status, "Active")}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="catalog-filter-field">
                    <span>Priority</span>
                    <select value={casePriorityFilter} onChange={(event) => setCasePriorityFilter(event.target.value)}>
                      <option value="all">All priorities</option>
                      {casePriorityOptions.map((priority) => (
                        <option key={priority} value={priority}>
                          {`P${priority}`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="catalog-filter-field">
                    <span>Steps</span>
                    <select value={caseStepFilter} onChange={(event) => setCaseStepFilter(event.target.value as CaseStepFilter)}>
                      <option value="all">All cases</option>
                      <option value="with-steps">With steps</option>
                      <option value="no-steps">Without steps</option>
                    </select>
                  </label>

                  <label className="catalog-filter-field">
                    <span>Recent runs</span>
                    <select value={caseRunFilter} onChange={(event) => setCaseRunFilter(event.target.value as CaseRunFilter)}>
                      <option value="all">All cases</option>
                      <option value="with-runs">With recent runs</option>
                      <option value="no-runs">No recent runs</option>
                    </select>
                  </label>

                  <div className="catalog-filter-actions">
                    <button
                      className="ghost-button"
                      disabled={!activeCaseFilterCount}
                      onClick={() => {
                        setCaseStatusFilter("all");
                        setCasePriorityFilter("all");
                        setCaseStepFilter("all");
                        setCaseRunFilter("all");
                      }}
                      type="button"
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
              </CatalogSearchFilter>
              <button
                className="ghost-button"
                disabled={!filteredCases.length || areAllFilteredCasesSelected}
                onClick={() =>
                  setSelectedActionTestCaseIds((current) => [...new Set([...current, ...filteredCases.map((item) => item.id)])])
                }
                type="button"
              >
                Select all visible
              </button>
              <button
                className="ghost-button"
                disabled={!selectedActionTestCaseIds.length}
                onClick={() => setSelectedActionTestCaseIds([])}
                type="button"
              >
                Clear selection
              </button>
              <button className="ghost-button" disabled={!appTypeId} onClick={() => setIsCreateSuiteModalOpen(true)} type="button">
                Create suite
              </button>
              <button
                className="ghost-button"
                disabled={!projectId || !appTypeId || !selectedActionTestCaseIds.length || !session?.user.id}
                onClick={() => setIsCreateExecutionModalOpen(true)}
                type="button"
              >
                Create execution
              </button>
              <button
                className="ghost-button danger"
                disabled={!selectedActionTestCaseIds.length || isDeletingSelectedTestCases}
                onClick={() => void handleDeleteSelectedCases()}
                type="button"
              >
                {isDeletingSelectedTestCases ? "Deleting…" : `Delete selected${selectedActionTestCaseIds.length ? ` (${selectedActionTestCaseIds.length})` : ""}`}
              </button>
              <button className="ghost-button" disabled={!appTypeId} onClick={beginCreateCase} type="button">
                New case
              </button>
            </div>

            {selectedActionTestCaseIds.length ? (
              <div className="detail-summary test-case-selection-summary">
                <strong>{selectedActionTestCaseIds.length} test case{selectedActionTestCaseIds.length === 1 ? "" : "s"} selected for bulk actions</strong>
                <span>Use the checked cases to create a suite, create an execution under the linked Default suite snapshot, or bulk delete them. Open any tile body to keep editing one case at a time.</span>
              </div>
            ) : null}

            {isLibraryLoading ? (
              <div className="tile-browser-grid test-case-library-scroll">
                <div className="skeleton-block" />
                <div className="skeleton-block" />
                <div className="skeleton-block" />
              </div>
            ) : null}

            {!isLibraryLoading ? (
              <div className="tile-browser-grid test-case-library-scroll">
                {filteredCases.map((testCase) => {
                  const isSelectedForAction = selectedActionTestCaseIds.includes(testCase.id);
                  const isActive = selectedTestCaseId === testCase.id && !isCreating;
                  const history = (historyByCaseId[testCase.id] || []).slice(0, 10);
                  const latest = history[0];
                  const requirementTitle =
                    (testCase.requirement_ids || [testCase.requirement_id]).map((id) => (id ? requirementTitleById[id] || "" : "")).find(Boolean) || "";
                  const stepCount = stepCountByCaseId[testCase.id] || 0;
                  const caseStatusValue = latest?.status || testCase.status || "active";
                  const caseStatusLabel = formatTileCardLabel(caseStatusValue, "Active");
                  const caseStatusTone = getTileCardTone(caseStatusValue);
                  const suiteCount = (testCase.suite_ids || []).length || 0;

                  return (
                    <button
                      className={[
                        "record-card tile-card test-case-card test-case-catalog-card",
                        isActive ? "is-active" : "",
                        isSelectedForAction ? "is-marked-for-delete" : ""
                      ].filter(Boolean).join(" ")}
                      key={testCase.id}
                      onClick={() => {
                        setSelectedTestCaseId(testCase.id);
                        setIsCreating(false);
                        setDraftSteps([]);
                      }}
                      type="button"
                    >
                      <div className="tile-card-main">
                        <div className="tile-card-header">
                          <TileCardIconFrame tone={caseStatusTone}>
                          <TileCardCaseIcon />
                        </TileCardIconFrame>
                        <div className="tile-card-title-group">
                          <strong>{testCase.title}</strong>
                          <span className="tile-card-kicker">{requirementTitle || "No requirement linked"}</span>
                        </div>
                          <TileCardStatusIndicator title={caseStatusLabel} tone={caseStatusTone} />
                        </div>
                        <p className="tile-card-description">{testCase.description || "No description yet for this test case."}</p>
                        <div className="tile-card-facts" aria-label={`${testCase.title} facts`}>
                          <TileCardFact
                            label={`P${testCase.priority || 3}`}
                            title={`Priority P${testCase.priority || 3}`}
                            tone={(testCase.priority || 3) <= 2 ? "danger" : "info"}
                          >
                            <TileCardPriorityIcon />
                          </TileCardFact>
                          <TileCardFact
                            label={String(stepCount)}
                            title={`${stepCount} step${stepCount === 1 ? "" : "s"}`}
                            tone={stepCount ? "info" : "neutral"}
                          >
                            <TileCardStepsIcon />
                          </TileCardFact>
                          <TileCardFact
                            label={String(suiteCount)}
                            title={`${suiteCount} linked suite${suiteCount === 1 ? "" : "s"}`}
                            tone={suiteCount ? "success" : "neutral"}
                          >
                            <TileCardLinkIcon />
                          </TileCardFact>
                          <TileCardFact
                            label={String(history.length)}
                            title={`${history.length} recent run${history.length === 1 ? "" : "s"}`}
                            tone={history.length ? getTileCardTone(latest?.status || caseStatusValue) : "neutral"}
                          >
                            <TileCardRunsIcon />
                          </TileCardFact>
                        </div>
                        <div className="tile-card-footer">
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
                        <label className="checkbox-field test-case-delete-checkbox" onClick={(event) => event.stopPropagation()}>
                          <input
                            checked={isSelectedForAction}
                            onChange={(event) =>
                              setSelectedActionTestCaseIds((current) =>
                                event.target.checked ? [...new Set([...current, testCase.id])] : current.filter((id) => id !== testCase.id)
                              )
                            }
                            type="checkbox"
                          />
                          Select case
                        </label>
                      </div>
                    </button>
                  );
                })}
                {!filteredCases.length ? (
                  <div className="empty-state compact">{testCases.length ? "No test cases match the current search." : "No test cases found for this app type."}</div>
                ) : null}
              </div>
            ) : null}
          </Panel>
        )}
        detailView={(
          <Panel
            actions={<WorkspaceBackButton label="Back to test case tiles" onClick={closeCaseWorkspace} />}
            title="Test case workspace"
            subtitle={selectedTestCaseId || isCreating ? "Switch between case details and step editing without losing the selected context." : "Select a test case or create a new one."}
          >
            {selectedTestCaseId || isCreating ? (
              <div className="detail-stack">
                <div className="editor-accordion">
                  <EditorAccordionSection
                    countLabel={isCreating ? "Draft" : caseDraft.status || "active"}
                    isExpanded={expandedSections.case}
                    onToggle={() => setExpandedSections((current) => ({ ...current, case: !current.case }))}
                    summary={caseSectionSummary}
                    title={isCreating ? "New test case" : "Selected test case"}
                  >
                    <form className="form-grid" onSubmit={(event) => void handleSaveCase(event)}>
                      <div className="record-grid">
                        <FormField label="Title" required>
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
                            <option value="ready">ready</option>
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
                        <button className="primary-button" disabled={createTestCase.isPending || updateTestCase.isPending} type="submit">
                          {isCreating ? (createTestCase.isPending ? "Creating…" : "Create test case") : (updateTestCase.isPending ? "Saving…" : "Save test case")}
                        </button>
                        {isCreating ? (
                          <button
                            className="ghost-button"
                            onClick={() => {
                              setIsCreating(false);
                              setDraftSteps([]);
                              setNewStepDraft(EMPTY_STEP_DRAFT);
                              setStepInsertIndex(null);
                              setStepInsertGroupContext(null);
                              setSelectedStepIds([]);
                            }}
                            type="button"
                          >
                            Cancel new case
                          </button>
                        ) : null}
                        {!isCreating && selectedTestCase ? (
                          <button className="ghost-button danger" onClick={() => void handleDeleteCase()} type="button">
                            Delete test case
                          </button>
                        ) : null}
                      </div>
                    </form>
                  </EditorAccordionSection>

                  <EditorAccordionSection
                    countLabel={stepCountLabel}
                    isExpanded={expandedSections.steps}
                    onToggle={() => setExpandedSections((current) => ({ ...current, steps: !current.steps }))}
                    summary={stepSectionSummary}
                    title={isCreating ? "Draft steps" : "Test steps"}
                  >
                    <div className="step-editor step-editor--embedded">
                      <div className="action-row step-editor-toolbar">
                        {!isCreating && displaySteps.length ? (
                          <>
                            <StepIconButton
                              ariaLabel="Expand all steps"
                              onClick={() => {
                                setExpandedStepIds(displaySteps.map((step) => step.id));
                                setExpandedStepGroupIds(stepGroupIds);
                              }}
                              title="Expand all steps"
                              type="button"
                            >
                              <StepExpandAllIcon />
                            </StepIconButton>
                            <StepIconButton
                              ariaLabel="Collapse all steps"
                              onClick={() => {
                                setExpandedStepIds([]);
                                setExpandedStepGroupIds([]);
                              }}
                              title="Collapse all steps"
                              type="button"
                            >
                              <StepCollapseAllIcon />
                            </StepIconButton>
                          </>
                        ) : null}
                        <StepIconButton
                          ariaLabel="Copy selected steps"
                          count={selectedEditorSteps.length}
                          disabled={!selectedEditorSteps.length}
                          onClick={() => handleCopySteps()}
                          title="Copy selected steps"
                          type="button"
                        >
                          <StepCopyIcon />
                        </StepIconButton>
                        <StepIconButton
                          ariaLabel="Cut selected steps"
                          count={selectedEditorSteps.length}
                          disabled={!selectedEditorSteps.length}
                          onClick={() => handleCutSteps()}
                          title="Cut selected steps"
                          type="button"
                        >
                          <StepCutIcon />
                        </StepIconButton>
                        <StepIconButton
                          ariaLabel={copiedStepMode === "cut" ? "Paste cut steps" : "Paste copied steps"}
                          count={copiedSteps.length}
                          disabled={!copiedSteps.length}
                          onClick={() => void handlePasteSteps()}
                          title={copiedStepMode === "cut" ? "Paste cut steps" : "Paste copied steps"}
                          type="button"
                        >
                          <StepPasteIcon />
                        </StepIconButton>
                        <StepIconButton
                          ariaLabel="Group selected steps"
                          count={selectedEditorSteps.length}
                          disabled={!selectedEditorSteps.length}
                          onClick={handleOpenStepGroupModal}
                          title="Group selected steps"
                          type="button"
                        >
                          <StepGroupIcon />
                        </StepIconButton>
                        <StepIconButton
                          ariaLabel="Delete selected steps"
                          count={selectedEditorSteps.length}
                          disabled={!selectedEditorSteps.length}
                          onClick={() => void handleDeleteSelectedSteps()}
                          title="Delete selected steps"
                          tone="danger"
                          type="button"
                        >
                          <StepDeleteIcon />
                        </StepIconButton>
                        <StepIconButton
                          ariaLabel="Insert shared group"
                          disabled={!appTypeId}
                          onClick={() => {
                            setIsSharedGroupPickerOpen(true);
                            setSelectedSharedGroupId((current) => current || sharedStepGroups[0]?.id || "");
                          }}
                          title="Insert shared group"
                          type="button"
                        >
                          <StepSharedGroupIcon />
                        </StepIconButton>
                        {selectedEditorSteps.length ? (
                          <StepIconButton
                            ariaLabel="Clear step selection"
                            count={selectedEditorSteps.length}
                            onClick={() => setSelectedStepIds([])}
                            title="Clear step selection"
                            type="button"
                          >
                            <StepClearSelectionIcon />
                          </StepIconButton>
                        ) : null}
                      </div>

                      {selectedEditorSteps.length ? (
                        <div className="detail-summary">
                          <strong>{selectedEditorSteps.length} step{selectedEditorSteps.length === 1 ? "" : "s"} selected</strong>
                          <span>Select a continuous range to group them, copy them into the paste buffer, or paste the current buffer after the selection.</span>
                        </div>
                      ) : null}

                      {copiedSteps.length ? (
                        <div className="detail-summary">
                          <strong>{copiedSteps.length} {copiedStepMode === "cut" ? "cut" : "copied"} step{copiedSteps.length === 1 ? "" : "s"} ready to paste</strong>
                          <span>{copiedStepMode === "cut" ? "Use a paste target to move the cut steps into place." : "Use any paste target to place them exactly where you want, even in another test case under the same app type."}</span>
                        </div>
                      ) : null}

                      {!isCreating && stepsQuery.isLoading ? <div className="empty-state compact">Loading steps…</div> : null}

                      <div className="step-list">
                        {!displaySteps.length ? renderStepInsertSlot(0, null, true) : null}

                        {stepBlocks.map((block) => {
                          if (block.group_id) {
                            const firstStep = block.steps[0];
                            const lastStep = block.steps[block.steps.length - 1];
                            const isGroupExpanded = expandedStepGroupIds.includes(block.group_id);
                            const blockGroupContext: StepInsertionGroupContext = {
                              group_id: block.group_id,
                              group_name: block.group_name,
                              group_kind: block.group_kind || null,
                              reusable_group_id: block.reusable_group_id
                            };

                            return (
                              <Fragment key={block.key}>
                                {renderStepInsertSlot(Math.max(0, firstStep.step_order - 1))}
                                <div
                                  className={[
                                    isGroupExpanded ? "step-group-block is-expanded" : "step-group-block is-collapsed",
                                    block.group_kind === "reusable" ? "is-shared-group" : "is-local-group"
                                  ].join(" ")}
                                >
                                  <StepGroupHeader
                                    canPaste={Boolean(copiedSteps.length)}
                                    isExpanded={isGroupExpanded}
                                    kind={block.group_kind}
                                    name={block.group_name || "Step group"}
                                    onInsertAbove={() => activateStepInsert(Math.max(0, firstStep.step_order - 1))}
                                    onInsertBelow={() => activateStepInsert(lastStep.step_order)}
                                    onToggle={() =>
                                      setExpandedStepGroupIds((current) =>
                                        current.includes(block.group_id as string)
                                          ? current.filter((id) => id !== block.group_id)
                                        : [...current, block.group_id as string]
                                      )
                                    }
                                    onPasteAbove={() => void handlePasteSteps(Math.max(0, firstStep.step_order - 1))}
                                    onPasteBelow={() => void handlePasteSteps(lastStep.step_order)}
                                    onRemoveGroup={() => void handleRemoveStepGroup(block.group_id as string, block.steps, block.group_kind)}
                                    onUngroup={() => void handleUngroupStepGroup(block.group_id as string, block.group_kind)}
                                    stepCount={block.steps.length}
                                  />
                                  {isGroupExpanded ? (
                                    <div className="step-group-block-body">
                                      {block.steps.map((step) => {
                                        const stepIndex = displaySteps.findIndex((item) => item.id === step.id);

                                        return (
                                          <Fragment key={step.id}>
                                            {renderStepInsertSlot(Math.max(0, step.step_order - 1), blockGroupContext)}
                                            {renderStepCard(step, stepIndex, blockGroupContext)}
                                          </Fragment>
                                        );
                                      })}
                                      {renderStepInsertSlot(lastStep.step_order, blockGroupContext)}
                                    </div>
                                  ) : null}
                                </div>
                                {lastStep.id === displaySteps[displaySteps.length - 1]?.id ? renderStepInsertSlot(lastStep.step_order) : null}
                              </Fragment>
                            );
                          }

                          const step = block.steps[0];
                          const stepIndex = displaySteps.findIndex((item) => item.id === step.id);

                          return (
                            <Fragment key={block.key}>
                              {renderStepInsertSlot(Math.max(0, step.step_order - 1))}
                              {renderStepCard(step, stepIndex)}
                              {step.id === displaySteps[displaySteps.length - 1]?.id ? renderStepInsertSlot(step.step_order) : null}
                            </Fragment>
                          );
                        })}
                      </div>

                      {!displaySteps.length ? (
                        <div className="empty-state compact">
                          {isCreating
                            ? "No draft steps yet. Use the inline + action to add the first step or insert a shared group."
                            : "No steps yet for this test case. Use the inline + action to add one or insert a shared group."}
                        </div>
                      ) : null}
                    </div>
                  </EditorAccordionSection>

                  {!isCreating ? (
                    <EditorAccordionSection
                      countLabel={`${selectedHistory.length} record${selectedHistory.length === 1 ? "" : "s"}`}
                      isExpanded={expandedSections.history}
                      onToggle={() => setExpandedSections((current) => ({ ...current, history: !current.history }))}
                      summary={historySectionSummary}
                      title="Execution history"
                    >
                      <div className="step-editor step-history">
                        <div className="stack-list">
                          {selectedHistory.map((result) => {
                            const execution = executionsById[result.execution_id];
                            const executionLabel = execution?.name?.trim() || `Execution ${result.execution_id.slice(0, 8)}`;
                            const executionSummary = [
                              execution?.status ? `Run ${execution.status}` : null,
                              formatExecutionHistoryDate(result.created_at)
                            ].filter(Boolean).join(" · ");
                            const historyDetail =
                              result.error ||
                              (result.status === "passed"
                                ? "Passed in this execution snapshot."
                                : result.status === "failed"
                                  ? "Failed in this execution snapshot."
                                  : "Blocked in this execution snapshot.");

                            return (
                              <div className="stack-item execution-history-item" key={result.id}>
                                <div>
                                  <strong>{executionLabel}</strong>
                                  <span>{executionSummary}</span>
                                  <span>{historyDetail}</span>
                                </div>
                                <div className="execution-history-item-actions">
                                  <StatusBadge value={result.status} />
                                  <button className="ghost-button" onClick={() => openExecutionHistoryResult(result)} type="button">
                                    Open run
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          {!selectedHistory.length ? <div className="empty-state compact">No execution history yet for this test case.</div> : null}
                        </div>
                      </div>
                    </EditorAccordionSection>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="empty-state compact">Select a test case from the library, or start a new one for this app type.</div>
            )}
          </Panel>
        )}
        isDetailOpen={Boolean(selectedTestCaseId) || isCreating}
      />

      {isStepGroupModalOpen ? (
        <StepGroupModal
          isSaving={groupSteps.isPending || createSharedStepGroup.isPending}
          name={stepGroupName}
          onClose={() => {
            setIsStepGroupModalOpen(false);
            setStepGroupName("");
            setSaveAsReusableGroup(false);
          }}
          onNameChange={setStepGroupName}
          onSave={() => void handleConfirmStepGroup()}
          reusable={saveAsReusableGroup}
          selectedCount={selectedEditorSteps.length}
          setReusable={setSaveAsReusableGroup}
        />
      ) : null}

      {isSharedGroupPickerOpen ? (
        <SharedGroupPickerModal
          groups={filteredSharedGroups}
          isLoading={sharedStepGroupsQuery.isLoading}
          onClose={() => {
            setIsSharedGroupPickerOpen(false);
            setSelectedSharedGroupId("");
            setSharedGroupSearchTerm("");
          }}
          onConfirm={() => void handleInsertSharedGroup()}
          onSearchChange={setSharedGroupSearchTerm}
          searchValue={sharedGroupSearchTerm}
          selectedGroup={selectedSharedGroup}
          selectedGroupId={selectedSharedGroupId}
          setSelectedGroupId={setSelectedSharedGroupId}
        />
      ) : null}

      {isCreateSuiteModalOpen ? (
        <TestCaseSuiteModal
          appTypeCases={testCases}
          isSaving={createSuite.isPending || assignSuiteCases.isPending}
          onClose={() => setIsCreateSuiteModalOpen(false)}
          onSubmit={handleCreateSuite}
          selectedCaseIds={selectedActionTestCaseIds}
          suites={suites}
        />
      ) : null}

      {isCreateExecutionModalOpen ? (
        <TestCaseExecutionModal
          appTypeId={appTypeId}
          canCreateExecution={Boolean(projectId && appTypeId && selectedActionCases.length && session?.user.id)}
          executionName={executionName}
          isSubmitting={createExecution.isPending}
          onClose={closeCreateExecutionModal}
          onConfigurationChange={setSelectedExecutionConfigurationId}
          onDataSetChange={setSelectedExecutionDataSetId}
          onEnvironmentChange={setSelectedExecutionEnvironmentId}
          onExecutionNameChange={setExecutionName}
          onRemoveTestCase={(testCaseId) =>
            setSelectedActionTestCaseIds((current) => current.filter((id) => id !== testCaseId))
          }
          onSubmit={handleCreateExecution}
          projectId={projectId}
          selectedConfigurationId={selectedExecutionConfigurationId}
          selectedAppType={selectedAppType?.name || ""}
          selectedDataSetId={selectedExecutionDataSetId}
          selectedEnvironmentId={selectedExecutionEnvironmentId}
          selectedProject={selectedProject?.name || ""}
          testCases={selectedActionCases}
        />
      ) : null}

      {isImportModalOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => !importTestCases.isPending && setIsImportModalOpen(false)}
        >
          <div
            aria-labelledby="bulk-import-title"
            aria-modal="true"
            className="modal-card import-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="import-modal-header">
              <div className="import-modal-title">
                <p className="eyebrow">Bulk Import</p>
                <h3 id="bulk-import-title">Import test cases from CSV</h3>
                <p>Upload reusable cases in bulk. Action and Expected Result create attached steps automatically, while optional group columns preserve shared and local step snapshots.</p>
              </div>
              <button aria-label="Close bulk import dialog" className="ghost-button" disabled={importTestCases.isPending} onClick={() => setIsImportModalOpen(false)} type="button">
                Close
              </button>
            </div>

            <div className="import-modal-body">
              <div className="record-grid">
                <FormField label="CSV file">
                  <input accept=".csv,text/csv" onChange={(event) => void handleImportFile(event)} type="file" />
                </FormField>

                <FormField label="Default requirement">
                  <select value={importRequirementId} onChange={(event) => setImportRequirementId(event.target.value)}>
                    <option value="">No requirement</option>
                    {requirements.map((requirement) => (
                      <option key={requirement.id} value={requirement.id}>{requirement.title}</option>
                    ))}
                  </select>
                </FormField>
              </div>

              <div className="metric-strip compact">
                <div className="mini-card">
                  <strong>{importRows.length}</strong>
                  <span>Rows ready</span>
                </div>
                <div className="mini-card">
                  <strong>{importStepCount}</strong>
                  <span>Steps detected</span>
                </div>
              </div>

              <div className="detail-summary">
                <strong>{importFileName || "No CSV loaded yet"}</strong>
                <span>Use new lines or the `|` character in Action and Expected Result to create multiple steps. Optional `Step Group Name`, `Step Group Kind`, and `Shared Group ID` columns keep grouped snapshots aligned step-by-step.</span>
              </div>

              {importWarnings.length ? (
                <div className="empty-state compact">
                  {importWarnings.slice(0, 4).map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}

              {importRows.length ? (
                <div className="table-wrap import-preview-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Step count</th>
                        <th>Groups</th>
                        <th>Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 5).map((row, index) => (
                        <tr key={`${row.title}-${index}`}>
                          <td>{row.title}</td>
                          <td>{countImportedSteps(row)}</td>
                          <td>{countImportedGroups(row)}</td>
                          <td>{getImportedStepPreviewLabel(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            <div className="action-row import-modal-actions">
              <button className="primary-button" disabled={!appTypeId || !importRows.length || importTestCases.isPending} onClick={() => void handleBulkImport()} type="button">
                {importTestCases.isPending ? "Importing…" : `Import ${importRows.length || ""} Test Cases`}
              </button>
              <button
                className="ghost-button"
                disabled={!importRows.length || importTestCases.isPending}
                onClick={() => {
                  setImportRows([]);
                  setImportWarnings([]);
                  setImportFileName("");
                }}
                type="button"
              >
                Clear preview
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAiStudioOpen ? (
        <AiDesignStudioModal
          acceptLabel="Accept Into Test Case Library"
          additionalContext={aiAdditionalContext}
          allowMultipleRequirements={true}
          appTypeName={appTypes.find((item) => item.id === appTypeId)?.name || "No app type selected"}
          closeDisabled={previewDesignedCases.isPending || acceptDesignedCases.isPending}
          disableAccept={!aiPreviewCases.length || acceptDesignedCases.isPending}
          disablePreview={!aiRequirementIds.length || !appTypeId || previewDesignedCases.isPending || !integrations.length}
          existingCases={aiExistingCases}
          existingCasesSubtitle="These reusable cases are already linked to one or more of the selected requirements in the current app type."
          existingCasesTitle="Existing related cases"
          externalLinksText={aiExternalLinksText}
          eyebrow="Test Cases"
          integrationId={integrationId}
          integrations={integrations}
          isAccepting={acceptDesignedCases.isPending}
          isPreviewing={previewDesignedCases.isPending}
          maxCases={maxCases}
          onAccept={() => void handleAcceptDesignedCases()}
          onAddImages={(files) => void handleAddAiReferenceImages(files)}
          onAdditionalContextChange={setAiAdditionalContext}
          onClose={() => {
            setIsAiStudioOpen(false);
            setAiPreviewCases([]);
            setAiPreviewMessage("");
          }}
          onExternalLinksTextChange={setAiExternalLinksText}
          onIntegrationIdChange={setIntegrationId}
          onPreview={() => void handlePreviewDesignedCases()}
          onRemoveImage={(imageUrl) => setAiReferenceImages((current) => current.filter((image) => image.url !== imageUrl))}
          onRemovePreviewCase={(clientId) => setAiPreviewCases((current) => current.filter((candidate) => candidate.client_id !== clientId))}
          onRequirementSelectionChange={setAiRequirementIds}
          onTogglePreviewRequirement={(clientId, requirementId) => {
            const requirement = requirements.find((item) => item.id === requirementId);

            if (!requirement) {
              return;
            }

            setAiPreviewCases((current) => toggleRequirementOnPreviewCase(current, clientId, requirementId, requirement.title));
          }}
          onMaxCasesChange={setMaxCases}
          previewCases={aiPreviewCases}
          previewMessage={aiPreviewMessage}
          previewTone={aiPreviewTone}
          referenceImages={aiReferenceImages}
          requirementHelpText="Select one or more requirements, provide extra context, then review the generated drafts before approving them into the reusable library."
          requirementLabel="Requirements"
          requirements={requirements}
          selectedRequirementIds={aiSelectedRequirements.map((requirement) => requirement.id)}
        />
      ) : null}
    </div>
  );
}

function TestCaseSuiteModal({
  suites,
  appTypeCases,
  selectedCaseIds,
  onClose,
  onSubmit,
  isSaving
}: {
  suites: TestSuite[];
  appTypeCases: TestCase[];
  selectedCaseIds: string[];
  onClose: () => void;
  onSubmit: (input: { name: string; parent_id?: string; selectedIds: string[] }) => void;
  isSaving: boolean;
}) {
  const initialSelectedIds = useMemo(
    () => selectedCaseIds.filter((testCaseId) => appTypeCases.some((testCase) => testCase.id === testCaseId)),
    [appTypeCases, selectedCaseIds]
  );
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>(() => initialSelectedIds);

  useEffect(() => {
    setLocalSelectedIds(initialSelectedIds);
  }, [initialSelectedIds]);

  return (
    <div className="modal-backdrop" onClick={() => !isSaving && onClose()} role="presentation">
      <div
        aria-label="Create suite from test cases"
        aria-modal="true"
        className="modal-card suite-create-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <h3>Create Suite</h3>
            <p>Choose reusable cases, keep their saved order with the arrow controls, and create the suite from this dialog.</p>
          </div>
          <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <form
          className="form-grid suite-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({
              name,
              parent_id: parentId || undefined,
              selectedIds: localSelectedIds
            });
          }}
        >
          <div className="suite-modal-body">
            <div className="record-grid suite-modal-config-grid">
              <FormField label="Suite name">
                <input autoFocus required value={name} onChange={(event) => setName(event.target.value)} />
              </FormField>
              <FormField label="Parent suite">
                <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                  <option value="">None</option>
                  {suites.map((suite) => (
                    <option key={suite.id} value={suite.id}>{suite.name}</option>
                  ))}
                </select>
              </FormField>
            </div>

            <div className="suite-modal-picker-shell">
              <SuiteCasePicker
                cases={appTypeCases}
                description="Use bulk selection when needed, then set the saved suite order before creating it."
                emptyMessage="No test cases available in this app type yet."
                heading="Reusable test cases"
                onChange={setLocalSelectedIds}
                selectedCaseIds={localSelectedIds}
              />
            </div>
          </div>

          <div className="action-row suite-modal-actions">
            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : "Create Suite"}
            </button>
            <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TestCaseExecutionModal({
  testCases,
  selectedProject,
  selectedAppType,
  projectId,
  appTypeId,
  executionName,
  selectedEnvironmentId,
  selectedConfigurationId,
  selectedDataSetId,
  canCreateExecution,
  isSubmitting,
  onEnvironmentChange,
  onConfigurationChange,
  onDataSetChange,
  onExecutionNameChange,
  onRemoveTestCase,
  onClose,
  onSubmit
}: {
  testCases: TestCase[];
  selectedProject: string;
  selectedAppType: string;
  projectId: string;
  appTypeId: string;
  executionName: string;
  selectedEnvironmentId: string;
  selectedConfigurationId: string;
  selectedDataSetId: string;
  canCreateExecution: boolean;
  isSubmitting: boolean;
  onEnvironmentChange: (value: string) => void;
  onConfigurationChange: (value: string) => void;
  onDataSetChange: (value: string) => void;
  onExecutionNameChange: (value: string) => void;
  onRemoveTestCase: (testCaseId: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={() => !isSubmitting && onClose()} role="presentation">
      <div
        aria-labelledby="create-test-case-execution-title"
        aria-modal="true"
        className="modal-card execution-create-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <form className="execution-create-form" onSubmit={onSubmit}>
          <div className="execution-create-header">
            <div className="execution-create-title">
              <p className="eyebrow">Test Cases</p>
              <h3 id="create-test-case-execution-title">Create execution</h3>
              <p>The selected test cases will be snapshotted under a linked Default suite without creating a real suite record.</p>
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
            <FormField label="Execution name">
              <input
                autoFocus
                placeholder="Optional run name"
                value={executionName}
                onChange={(event) => onExecutionNameChange(event.target.value)}
              />
            </FormField>

            <div className="detail-summary">
              <strong>{selectedProject || "Select a project to continue"}</strong>
              <span>{selectedAppType ? `${selectedAppType} app type selected for this snapshot.` : "Choose an app type to load test cases."}</span>
              <span>{testCases.length ? `${testCases.length} test cases selected for this execution.` : "No test cases selected yet."}</span>
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
              <div className="selection-summary-card">
                <div className="selection-summary-header">
                  <div>
                    <strong>{testCases.length ? `${testCases.length} test cases selected` : "No test cases selected yet"}</strong>
                    <span>These came from the checkbox selections in the test case library. Remove any chip here before creating the execution.</span>
                  </div>
                </div>

                {testCases.length ? (
                  <div className="selection-chip-row">
                    {testCases.map((testCase) => (
                      <button key={testCase.id} className="selection-chip" disabled={isSubmitting} onClick={() => onRemoveTestCase(testCase.id)} type="button">
                        {testCase.title}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </FormField>
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

function EditorAccordionSection({
  title,
  summary,
  countLabel,
  isExpanded,
  onToggle,
  children
}: {
  title: string;
  summary: string;
  countLabel: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={isExpanded ? "editor-accordion-section is-expanded" : "editor-accordion-section"}>
      <button
        aria-expanded={isExpanded}
        className="editor-accordion-toggle"
        onClick={onToggle}
        type="button"
      >
        <div className="editor-accordion-toggle-main">
          <span aria-hidden="true" className={isExpanded ? "editor-accordion-icon is-expanded" : "editor-accordion-icon"}>
            <EditorAccordionChevronIcon />
          </span>
          <div className="editor-accordion-toggle-copy">
            <strong>{title}</strong>
            <span>{summary}</span>
          </div>
        </div>
        <div className="editor-accordion-toggle-meta">
          <span className="editor-accordion-toggle-count">{countLabel}</span>
          <span className="editor-accordion-toggle-state">{isExpanded ? "Collapse" : "Expand"}</span>
        </div>
      </button>
      {isExpanded ? <div className="editor-accordion-body">{children}</div> : null}
    </section>
  );
}

function EditorAccordionChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function StepIconButton({
  children,
  ariaLabel,
  title,
  onClick,
  count = 0,
  disabled = false,
  tone = "ghost",
  type = "button"
}: {
  children: ReactNode;
  ariaLabel: string;
  title: string;
  onClick: () => void;
  count?: number;
  disabled?: boolean;
  tone?: "ghost" | "primary" | "danger";
  type?: "button" | "submit" | "reset";
}) {
  const className =
    tone === "primary"
      ? "step-action-button step-action-button--primary"
      : tone === "danger"
        ? "step-action-button step-action-button--danger"
        : "step-action-button";

  return (
    <button aria-label={ariaLabel} className={count ? `${className} has-count` : className} disabled={disabled} onClick={onClick} title={title} type={type}>
      {children}
      {count ? <span className="step-action-count">{count}</span> : null}
    </button>
  );
}

function StepIconShell({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      {children}
    </svg>
  );
}

function StepMoveUpIcon() {
  return (
    <StepIconShell>
      <path d="m12 6-4 4" />
      <path d="m12 6 4 4" />
      <path d="M12 6v12" />
    </StepIconShell>
  );
}

function StepMoveDownIcon() {
  return (
    <StepIconShell>
      <path d="m12 18-4-4" />
      <path d="m12 18 4-4" />
      <path d="M12 6v12" />
    </StepIconShell>
  );
}

function StepSaveIcon() {
  return (
    <StepIconShell>
      <path d="M5 6.5A1.5 1.5 0 0 1 6.5 5h9l3.5 3.5V17.5A1.5 1.5 0 0 1 17.5 19h-11A1.5 1.5 0 0 1 5 17.5z" />
      <path d="M9 5v5h6V6" />
      <path d="M9 15h6" />
    </StepIconShell>
  );
}

function StepDeleteIcon() {
  return (
    <StepIconShell>
      <path d="M4 7h16" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M7 7l.8 11.1A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.9L17 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </StepIconShell>
  );
}

function StepExpandAllIcon() {
  return (
    <StepIconShell>
      <path d="M12 12V4" />
      <path d="m8.5 7.5 3.5-3.5 3.5 3.5" />
      <path d="M12 12v8" />
      <path d="m8.5 16.5 3.5 3.5 3.5-3.5" />
    </StepIconShell>
  );
}

function StepCollapseAllIcon() {
  return (
    <StepIconShell>
      <path d="M12 4v8" />
      <path d="m8.5 8.5 3.5 3.5 3.5-3.5" />
      <path d="M12 20v-8" />
      <path d="m8.5 15.5 3.5-3.5 3.5 3.5" />
    </StepIconShell>
  );
}

function StepCopyIcon() {
  return (
    <StepIconShell>
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </StepIconShell>
  );
}

function StepInsertIcon() {
  return (
    <StepIconShell>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
      <path d="M7 5h10" />
      <path d="M7 19h10" />
    </StepIconShell>
  );
}

function StepPasteIcon() {
  return (
    <StepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 10v6" />
      <path d="m9.5 13.5 2.5 2.5 2.5-2.5" />
    </StepIconShell>
  );
}

function StepCutIcon() {
  return (
    <StepIconShell>
      <circle cx="6" cy="7" r="2" />
      <circle cx="6" cy="17" r="2" />
      <path d="M8 8.5 19 18" />
      <path d="M8 15.5 19 6" />
    </StepIconShell>
  );
}

function StepInsertAboveIcon() {
  return (
    <StepIconShell>
      <path d="M12 19V7" />
      <path d="m8.5 10.5 3.5-3.5 3.5 3.5" />
      <path d="M6 4h12" />
      <path d="M8 15h8" />
    </StepIconShell>
  );
}

function StepInsertBelowIcon() {
  return (
    <StepIconShell>
      <path d="M12 5v12" />
      <path d="m8.5 13.5 3.5 3.5 3.5-3.5" />
      <path d="M8 9h8" />
      <path d="M6 20h12" />
    </StepIconShell>
  );
}

function StepPasteAboveIcon() {
  return (
    <StepIconShell>
      <path d="M8 6h8" />
      <path d="M7 8h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" />
      <path d="M12 16V4" />
      <path d="m8.5 7.5 3.5-3.5 3.5 3.5" />
    </StepIconShell>
  );
}

function StepPasteBelowIcon() {
  return (
    <StepIconShell>
      <path d="M8 4h8" />
      <path d="M7 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      <path d="M12 8v12" />
      <path d="m8.5 16.5 3.5 3.5 3.5-3.5" />
    </StepIconShell>
  );
}

function StepClearSelectionIcon() {
  return (
    <StepIconShell>
      <path d="M5 5l14 14" />
      <path d="M19 5 5 19" />
      <path d="M8 12h8" />
    </StepIconShell>
  );
}

function StepGroupIcon() {
  return (
    <StepIconShell>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
      <path d="M4 10h16" />
    </StepIconShell>
  );
}

function StepSharedGroupIcon() {
  return (
    <StepIconShell>
      <circle cx="7" cy="8" r="2.5" />
      <circle cx="17" cy="8" r="2.5" />
      <circle cx="12" cy="17" r="2.5" />
      <path d="m9.2 9.4 2 5.2" />
      <path d="m14.8 9.4-2 5.2" />
      <path d="M9.5 8h5" />
    </StepIconShell>
  );
}

function StepGroupChevronIcon() {
  return (
    <StepIconShell>
      <path d="m7 10 5 5 5-5" />
    </StepIconShell>
  );
}

function getStepKindMeta(groupKind?: TestStep["group_kind"] | null) {
  if (groupKind === "reusable") {
    return { label: "Shared step", tone: "shared" as const };
  }

  if (groupKind === "local") {
    return { label: "Local group step", tone: "local" as const };
  }

  return { label: "Standard step", tone: "default" as const };
}

function StepKindBadge({
  label,
  tone
}: {
  label: string;
  tone: "default" | "shared" | "local";
}) {
  return (
    <span className={["step-kind-badge", tone === "default" ? "" : `is-${tone}`].filter(Boolean).join(" ")}>
      {label}
    </span>
  );
}

function StepUngroupIcon() {
  return (
    <StepIconShell>
      <path d="M5 7h6v6H5z" />
      <path d="M13 11h6v6h-6z" />
      <path d="m9 16-3 3" />
      <path d="m6 16 3 3" />
      <path d="m18 5-3 3" />
      <path d="m15 5 3 3" />
    </StepIconShell>
  );
}

function InlineStepInsertSlot({
  index,
  isActive,
  isVisibleByDefault = false,
  canPaste,
  draft,
  onActivate,
  onCancel,
  onChange,
  onPaste,
  onSubmit
}: {
  index: number;
  isActive: boolean;
  isVisibleByDefault?: boolean;
  canPaste: boolean;
  draft: StepDraft;
  onActivate: () => void;
  onCancel: () => void;
  onChange: (draft: StepDraft) => void;
  onPaste: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const insertTitle = index === 0 ? "Add first step" : "Insert step here";

  if (!isActive && !isVisibleByDefault) {
    return null;
  }

  return (
    <div className={["step-insert-slot", isActive ? "is-active" : "", isVisibleByDefault ? "is-visible" : ""].filter(Boolean).join(" ")}>
      {!isActive ? (
        <div className="step-insert-actions">
          <StepIconButton ariaLabel={insertTitle} onClick={onActivate} title={insertTitle} type="button">
            <StepInsertIcon />
          </StepIconButton>
          {canPaste ? (
            <StepIconButton ariaLabel="Paste copied here" onClick={onPaste} title="Paste copied here" type="button">
              <StepPasteIcon />
            </StepIconButton>
          ) : null}
        </div>
      ) : (
        <form className="step-create step-create--inline" onSubmit={onSubmit}>
          <strong>{index === 0 ? "+ Add Step" : "+ Insert Step"}</strong>
          <FormField label="Action">
            <input
              autoFocus
              value={draft.action}
              onChange={(event) => onChange({ ...draft, action: event.target.value })}
            />
          </FormField>
          <FormField label="Expected result">
            <textarea
              rows={3}
              value={draft.expected_result}
              onChange={(event) => onChange({ ...draft, expected_result: event.target.value })}
            />
          </FormField>
          <div className="action-row">
            <button className="primary-button" type="submit">Save step</button>
            <button className="ghost-button" onClick={onCancel} type="button">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function StepGroupHeader({
  name,
  kind,
  stepCount,
  canPaste,
  isExpanded,
  onInsertAbove,
  onInsertBelow,
  onToggle,
  onPasteAbove,
  onPasteBelow,
  onRemoveGroup,
  onUngroup
}: {
  name: string;
  kind: TestStep["group_kind"];
  stepCount: number;
  canPaste: boolean;
  isExpanded: boolean;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onToggle: () => void;
  onPasteAbove: () => void;
  onPasteBelow: () => void;
  onRemoveGroup: () => void;
  onUngroup: () => void;
}) {
  const isSharedGroup = kind === "reusable";
  const kindLabel = isSharedGroup ? "Shared group snapshot" : "Local step group";
  const unlinkTitle = isSharedGroup ? "Unlink shared group from this case" : "Ungroup steps";
  const removeTitle = isSharedGroup ? "Remove shared group from this case" : "Remove group and steps";

  return (
    <div className="step-group-header">
      <button
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${name}`}
        className="step-group-toggle"
        onClick={onToggle}
        type="button"
      >
        <span aria-hidden="true" className={isExpanded ? "step-group-chevron is-expanded" : "step-group-chevron"}>
          <StepGroupChevronIcon />
        </span>
        <span aria-hidden="true" className={isSharedGroup ? "step-group-icon is-shared" : "step-group-icon is-local"} title={kindLabel}>
          {isSharedGroup ? <StepSharedGroupIcon /> : <StepGroupIcon />}
        </span>
        <span className="step-group-title">
          <span className="step-group-title-row">
            <strong>{name}</strong>
            <StepKindBadge label={isSharedGroup ? "Shared group" : "Local group"} tone={isSharedGroup ? "shared" : "local"} />
          </span>
          <span>{stepCount} step{stepCount === 1 ? "" : "s"}</span>
        </span>
      </button>
      <div className="step-group-header-actions">
        <StepIconButton ariaLabel={`Insert step above ${name}`} onClick={onInsertAbove} title="Insert above group" type="button">
          <StepInsertAboveIcon />
        </StepIconButton>
        <StepIconButton ariaLabel={`Insert step below ${name}`} onClick={onInsertBelow} title="Insert below group" type="button">
          <StepInsertBelowIcon />
        </StepIconButton>
        {canPaste ? (
          <>
            <StepIconButton ariaLabel={`Paste above ${name}`} onClick={onPasteAbove} title="Paste above group" type="button">
              <StepPasteAboveIcon />
            </StepIconButton>
            <StepIconButton ariaLabel={`Paste below ${name}`} onClick={onPasteBelow} title="Paste below group" type="button">
              <StepPasteBelowIcon />
            </StepIconButton>
          </>
        ) : null}
        <StepIconButton ariaLabel={unlinkTitle} onClick={onUngroup} title={unlinkTitle} type="button">
          <StepUngroupIcon />
        </StepIconButton>
        <StepIconButton ariaLabel={removeTitle} onClick={onRemoveGroup} title={removeTitle} tone="danger" type="button">
          <StepDeleteIcon />
        </StepIconButton>
      </div>
    </div>
  );
}

function EditableStepCard({
  step,
  isExpanded,
  isSelected,
  canPaste,
  canMoveUp,
  canMoveDown,
  onSave,
  onCopy,
  onCut,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onToggle,
  onToggleSelect,
  onMoveUp,
  onMoveDown,
  onPasteAbove,
  onPasteBelow
}: {
  step: TestStep;
  isExpanded: boolean;
  isSelected: boolean;
  canPaste: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSave: (input: StepDraft) => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onToggle: () => void;
  onToggleSelect: (checked: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPasteAbove: () => void;
  onPasteBelow: () => void;
}) {
  const stepKind = getStepKindMeta(step.group_kind);

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
    <article
      className={[
        isExpanded ? "step-card is-expanded" : "step-card",
        step.group_kind === "reusable" ? "step-card--shared" : "",
        step.group_kind === "local" ? "step-card--grouped" : ""
      ].filter(Boolean).join(" ")}
    >
      <div className="step-card-top">
        <label className="checkbox-field step-card-select">
          <input checked={isSelected} onChange={(event) => onToggleSelect(event.target.checked)} type="checkbox" />
          Select
        </label>
        <button className="step-card-toggle" onClick={onToggle} type="button">
          <div className="step-card-summary">
            <div className="step-card-summary-top">
              <strong>Step {step.step_order}</strong>
              <StepKindBadge label={stepKind.label} tone={stepKind.tone} />
            </div>
            <span>{draft.action || "No action written yet"}</span>
          </div>
          <span className="step-card-toggle-state">{isExpanded ? "Hide" : "Show"}</span>
        </button>
        <div className="step-card-action-menu">
          <StepIconButton ariaLabel={`Insert above step ${step.step_order}`} onClick={onInsertAbove} title="Insert above" type="button">
            <StepInsertAboveIcon />
          </StepIconButton>
          <StepIconButton ariaLabel={`Insert below step ${step.step_order}`} onClick={onInsertBelow} title="Insert below" type="button">
            <StepInsertBelowIcon />
          </StepIconButton>
          {canPaste ? (
            <>
              <StepIconButton ariaLabel={`Paste above step ${step.step_order}`} onClick={onPasteAbove} title="Paste above" type="button">
                <StepPasteAboveIcon />
              </StepIconButton>
              <StepIconButton ariaLabel={`Paste below step ${step.step_order}`} onClick={onPasteBelow} title="Paste below" type="button">
                <StepPasteBelowIcon />
              </StepIconButton>
            </>
          ) : null}
          <StepIconButton ariaLabel={`Copy step ${step.step_order}`} onClick={onCopy} title="Copy step" type="button">
            <StepCopyIcon />
          </StepIconButton>
          <StepIconButton ariaLabel={`Cut step ${step.step_order}`} onClick={onCut} title="Cut step" type="button">
            <StepCutIcon />
          </StepIconButton>
          <StepIconButton ariaLabel={`Move step ${step.step_order} up`} disabled={!canMoveUp} onClick={onMoveUp} title="Move up" type="button">
            <StepMoveUpIcon />
          </StepIconButton>
          <StepIconButton ariaLabel={`Move step ${step.step_order} down`} disabled={!canMoveDown} onClick={onMoveDown} title="Move down" type="button">
            <StepMoveDownIcon />
          </StepIconButton>
          <StepIconButton ariaLabel={`Save step ${step.step_order}`} onClick={() => onSave(draft)} title="Save step" tone="primary" type="button">
            <StepSaveIcon />
          </StepIconButton>
          <StepIconButton ariaLabel={`Delete step ${step.step_order}`} onClick={onDelete} title="Delete step" tone="danger" type="button">
            <StepDeleteIcon />
          </StepIconButton>
        </div>
      </div>

      {isExpanded ? (
        <div className="step-card-body">
          <FormField label="Action">
            <input value={draft.action} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))} />
          </FormField>
          <FormField label="Expected result">
            <textarea rows={3} value={draft.expected_result} onChange={(event) => setDraft((current) => ({ ...current, expected_result: event.target.value }))} />
          </FormField>
        </div>
      ) : null}
    </article>
  );
}

function DraftStepCard({
  step,
  isSelected,
  canPaste,
  canMoveUp,
  canMoveDown,
  onChange,
  onCopy,
  onCut,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onToggleSelect,
  onMoveUp,
  onMoveDown,
  onPasteAbove,
  onPasteBelow
}: {
  step: { id: string; step_order: number; action: string; expected_result: string; group_id: string | null; group_name: string | null; group_kind: "local" | "reusable" | null; reusable_group_id: string | null };
  isSelected: boolean;
  canPaste: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (input: StepDraft) => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onToggleSelect: (checked: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPasteAbove: () => void;
  onPasteBelow: () => void;
}) {
  const stepKind = getStepKindMeta(step.group_kind);

  return (
    <article
      className={[
        "step-card is-expanded",
        step.group_kind === "reusable" ? "step-card--shared" : "",
        step.group_kind === "local" ? "step-card--grouped" : ""
      ].filter(Boolean).join(" ")}
    >
      <div className="step-card-top">
        <label className="checkbox-field step-card-select">
          <input checked={isSelected} onChange={(event) => onToggleSelect(event.target.checked)} type="checkbox" />
          Select
        </label>
        <div className="step-card-summary">
          <div className="step-card-summary-top">
            <strong>Step {step.step_order}</strong>
            <StepKindBadge label={stepKind.label} tone={stepKind.tone} />
          </div>
          <span>{step.action || step.expected_result || "Draft step details"}</span>
        </div>
        <div className="step-card-action-menu">
          <StepIconButton ariaLabel={`Insert above draft step ${step.step_order}`} onClick={onInsertAbove} title="Insert above" type="button">
            <StepInsertAboveIcon />
          </StepIconButton>
          <StepIconButton ariaLabel={`Insert below draft step ${step.step_order}`} onClick={onInsertBelow} title="Insert below" type="button">
            <StepInsertBelowIcon />
          </StepIconButton>
          {canPaste ? (
            <>
              <StepIconButton ariaLabel={`Paste above draft step ${step.step_order}`} onClick={onPasteAbove} title="Paste above" type="button">
                <StepPasteAboveIcon />
              </StepIconButton>
              <StepIconButton ariaLabel={`Paste below draft step ${step.step_order}`} onClick={onPasteBelow} title="Paste below" type="button">
                <StepPasteBelowIcon />
              </StepIconButton>
            </>
          ) : null}
          <StepIconButton ariaLabel={`Copy draft step ${step.step_order}`} onClick={onCopy} title="Copy step" type="button">
            <StepCopyIcon />
          </StepIconButton>
          <StepIconButton ariaLabel={`Cut draft step ${step.step_order}`} onClick={onCut} title="Cut step" type="button">
            <StepCutIcon />
          </StepIconButton>
          <StepIconButton ariaLabel={`Move draft step ${step.step_order} up`} disabled={!canMoveUp} onClick={onMoveUp} title="Move up" type="button">
            <StepMoveUpIcon />
          </StepIconButton>
          <StepIconButton ariaLabel={`Move draft step ${step.step_order} down`} disabled={!canMoveDown} onClick={onMoveDown} title="Move down" type="button">
            <StepMoveDownIcon />
          </StepIconButton>
          <StepIconButton ariaLabel={`Delete draft step ${step.step_order}`} onClick={onDelete} title="Delete step" tone="danger" type="button">
            <StepDeleteIcon />
          </StepIconButton>
        </div>
      </div>
      <div className="step-card-body">
        <FormField label="Action">
          <input
            value={step.action}
            onChange={(event) => onChange({ action: event.target.value, expected_result: step.expected_result })}
          />
        </FormField>
        <FormField label="Expected result">
          <textarea
            rows={3}
            value={step.expected_result}
            onChange={(event) => onChange({ action: step.action, expected_result: event.target.value })}
          />
        </FormField>
      </div>
    </article>
  );
}

function StepGroupModal({
  name,
  reusable,
  selectedCount,
  isSaving,
  onNameChange,
  setReusable,
  onSave,
  onClose
}: {
  name: string;
  reusable: boolean;
  selectedCount: number;
  isSaving: boolean;
  onNameChange: (value: string) => void;
  setReusable: (value: boolean) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();

  return (
    <div className="modal-backdrop" onClick={() => !isSaving && onClose()} role="presentation">
      <div
        aria-label="Create step group"
        aria-modal="true"
        className="modal-card suite-create-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <h3>Create Step Group</h3>
            <p>Name this group and decide whether it should stay local to this case or be reusable in other cases.</p>
          </div>
          <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="form-grid">
          <FormField label="Group name" required>
            <input
              data-autofocus="true"
              required
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </FormField>

          <label className="checkbox-field">
            <input checked={reusable} onChange={(event) => setReusable(event.target.checked)} type="checkbox" />
            Save as reusable group
          </label>

          <div className="detail-summary">
            <strong>{selectedCount} step{selectedCount === 1 ? "" : "s"} selected</strong>
            <span>{reusable ? "Reusable groups can be inserted into other test cases as snapshots." : "Local groups only organize the current case."}</span>
          </div>
        </div>

        <div className="action-row">
          <button className="primary-button" disabled={isSaving} onClick={onSave} type="button">
            {isSaving ? "Saving…" : reusable ? "Create reusable group" : "Create group"}
          </button>
          <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function SharedGroupPickerModal({
  groups,
  selectedGroupId,
  selectedGroup,
  isLoading,
  searchValue,
  onSearchChange,
  setSelectedGroupId,
  onConfirm,
  onClose
}: {
  groups: SharedStepGroup[];
  selectedGroupId: string;
  selectedGroup: SharedStepGroup | null;
  isLoading: boolean;
  searchValue: string;
  onSearchChange: (value: string) => void;
  setSelectedGroupId: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label="Insert shared step group"
        aria-modal="true"
        className="modal-card suite-create-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <h3>Insert Shared Group</h3>
            <p>Choose a reusable group to insert into this case. The case receives a snapshot copy of its current steps.</p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="form-grid">
          <FormField label="Search shared groups">
            <input
              data-autofocus="true"
              placeholder="Search by name or step text"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </FormField>

          <div className="stack-list">
            {isLoading ? <div className="empty-state compact">Loading shared groups…</div> : null}
            {!isLoading && groups.map((group) => (
              <label className="stack-item" key={group.id}>
                <div>
                  <strong>{group.name}</strong>
                  <span>{group.description || `${group.steps.length} reusable step${group.steps.length === 1 ? "" : "s"}`}</span>
                </div>
                <input
                  checked={selectedGroupId === group.id}
                  onChange={() => setSelectedGroupId(group.id)}
                  type="radio"
                />
              </label>
            ))}
            {!isLoading && !groups.length ? <div className="empty-state compact">No shared step groups match this search.</div> : null}
          </div>

          {selectedGroup ? (
            <div className="detail-summary">
              <strong>{selectedGroup.name}</strong>
              <span>
                {(selectedGroup.steps[0]?.action || selectedGroup.steps[0]?.expected_result || "No preview available")}
                {selectedGroup.steps.length > 1 ? ` · ${selectedGroup.steps.length} steps total` : ""}
              </span>
            </div>
          ) : null}
        </div>

        <div className="action-row">
          <button className="primary-button" disabled={!selectedGroupId} onClick={onConfirm} type="button">
            Insert selected group
          </button>
          <button className="ghost-button" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
