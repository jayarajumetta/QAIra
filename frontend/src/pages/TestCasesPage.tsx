import { ChangeEvent, FormEvent, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AiDesignStudioModal } from "../components/AiDesignStudioModal";
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
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { parseTestCaseCsv, type ImportedTestCaseRow } from "../lib/testCaseImport";
import { api } from "../lib/api";
import { appendUniqueImages, parseExternalLinks, readImageFiles, toggleRequirementOnPreviewCase } from "../lib/aiDesignStudio";
import type { AiDesignImageInput, AiDesignedTestCaseCandidate, AppType, Execution, ExecutionResult, Project, Requirement, TestCase, TestStep, TestSuite } from "../types";

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
};

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

const splitImportedStepValue = (value?: string) =>
  String(value || "")
    .split(/\r?\n|\|/)
    .map((item) => item.trim())
    .filter(Boolean);

const countImportedSteps = (row: ImportedTestCaseRow) =>
  Math.max(splitImportedStepValue(row.action).length, splitImportedStepValue(row.expected_result).length, 0);

const normalizeDraftSteps = (steps: DraftTestStep[]) =>
  steps
    .map((step, index) => ({
      step_order: index + 1,
      action: step.action.trim(),
      expected_result: step.expected_result.trim()
    }))
    .filter((step) => step.action || step.expected_result);

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
  const [isStepCreateVisible, setIsStepCreateVisible] = useState(false);
  const [draftSteps, setDraftSteps] = useState<DraftTestStep[]>([]);
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
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
            expected_result: step.expected_result
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
    setExpandedStepIds([]);
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
    setDraftSteps([]);
    setExpandedStepIds([]);
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

  const filteredCases = useMemo(() => {
    const search = deferredSearchTerm.trim().toLowerCase();

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
  }, [deferredSearchTerm, requirements, testCases]);

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
    setExpandedStepIds([]);
    setExpandedSections(createDefaultTestCaseSections());
  }, [isCreating, selectedTestCaseId]);

  useEffect(() => {
    setExpandedStepIds((current) => {
      const validIds = current.filter((id) => displaySteps.some((step) => step.id === id));
      return validIds;
    });
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
        setExpandedStepIds([]);
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
      setDraftSteps((current) => [...current, { id: draftId, ...normalizedDraft }]);
      setExpandedStepIds((current) => [...new Set([...current, draftId])]);
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setIsStepCreateVisible(false);
      showSuccess("Draft step added to the new test case.");
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      const nextStepOrder = (steps[steps.length - 1]?.step_order || 0) + 1;
      const response = await createStep.mutateAsync({
        test_case_id: selectedTestCaseId,
        step_order: nextStepOrder,
        action: normalizedDraft.action || undefined,
        expected_result: normalizedDraft.expected_result || undefined
      });
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setIsStepCreateVisible(false);
      setExpandedStepIds((current) => [...new Set([...current, response.id])]);
      showSuccess("Step added.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      showError(error, "Unable to add step");
    }
  };

  useEffect(() => {
    setIsStepCreateVisible(false);
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
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Draft step removed.");
      return;
    }

    if (!window.confirm("Delete this step?")) {
      return;
    }

    try {
      await deleteStep.mutateAsync(stepId);
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Step deleted.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      showError(error, "Unable to delete step");
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

      const header = ["title", "description", "priority", "status", "requirement", "suites", "action", "expected_result"];
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
          scopedSteps.map((step) => step.expected_result || "").join("\n")
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
      showSuccess(`Exported ${filteredCases.length} test cases to CSV.`);
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
      showSuccess("AI-designed test cases accepted into the library.");
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

  return (
    <div className="page-content page-content--library-full">
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

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

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

      <div className="test-case-workspace">
        <div className="test-case-sidebar">
          <Panel title="Test case library" subtitle={appTypeId ? "Search the library, scan quick quality signals, and jump into a case without the list taking over the page." : "Choose an app type to begin."}>
            <div className="design-list-toolbar test-case-catalog-toolbar">
              <input
                placeholder="Search title, description, or requirement"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
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
                <span>Use the checked cases to create a suite, create an execution under the linked Default suite snapshot, or bulk delete them. Click a card body to keep editing one test case at a time.</span>
              </div>
            ) : null}

            {isLibraryLoading ? (
              <div className="record-list test-case-library-scroll">
                <div className="skeleton-block" />
                <div className="skeleton-block" />
                <div className="skeleton-block" />
              </div>
            ) : null}

            {!isLibraryLoading ? (
              <div className="record-list test-case-library-scroll">
                {filteredCases.map((testCase) => {
                  const isSelectedForAction = selectedActionTestCaseIds.includes(testCase.id);
                  const isActive = selectedTestCaseId === testCase.id && !isCreating;
                  const history = (historyByCaseId[testCase.id] || []).slice(0, 10);
                  const latest = history[0];
                  const requirement = requirements.find((item) => (testCase.requirement_ids || [testCase.requirement_id]).includes(item.id));
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
                            <span className="tile-card-kicker">{requirement?.title || "No requirement linked"}</span>
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
        </div>

        <div className="test-case-editor-column">
          <Panel title="Test case workspace" subtitle={selectedTestCaseId || isCreating ? "Switch between case details and step editing without losing the selected context." : "Select a test case or create a new one."}>
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
                      {!isCreating && displaySteps.length ? (
                        <div className="action-row">
                          <button className="ghost-button" onClick={() => setExpandedStepIds(displaySteps.map((step) => step.id))} type="button">
                            Expand all
                          </button>
                          <button className="ghost-button" onClick={() => setExpandedStepIds([])} type="button">
                            Collapse all
                          </button>
                        </div>
                      ) : null}

                      {!isCreating && stepsQuery.isLoading ? <div className="empty-state compact">Loading steps…</div> : null}
                      {!displaySteps.length ? <div className="empty-state compact">{isCreating ? "No draft steps yet. Add steps below before you save if this case needs guided execution." : "No steps yet for this test case."}</div> : null}

                      <div className="step-list">
                        {isCreating
                          ? draftSteps.map((step, index) => (
                              <DraftStepCard
                                canMoveDown={index < draftSteps.length - 1}
                                canMoveUp={index > 0}
                                key={step.id}
                                onChange={(input) => handleUpdateDraftStep(step.id, input)}
                                onDelete={() => void handleDeleteStep(step.id)}
                                onMoveDown={() => handleReorderDraftStep(step.id, "down")}
                                onMoveUp={() => handleReorderDraftStep(step.id, "up")}
                                step={{ ...step, step_order: index + 1 }}
                              />
                            ))
                          : steps.map((step, index) => (
                              <EditableStepCard
                                key={step.id}
                                canMoveDown={index < steps.length - 1}
                                canMoveUp={index > 0}
                                isExpanded={expandedStepIds.includes(step.id)}
                                onDelete={() => void handleDeleteStep(step.id)}
                                onMoveDown={() => void handleReorderStep(step.id, "down")}
                                onMoveUp={() => void handleReorderStep(step.id, "up")}
                                onSave={(input) => void handleUpdateStep(step, input)}
                                onToggle={() =>
                                  setExpandedStepIds((current) =>
                                    current.includes(step.id) ? current.filter((id) => id !== step.id) : [...current, step.id]
                                  )
                                }
                                step={step}
                              />
                            ))}
                      </div>

                      {!isStepCreateVisible ? (
                        <div className="action-row">
                          <button className="ghost-button" onClick={() => setIsStepCreateVisible(true)} type="button">
                            + Add Step
                          </button>
                        </div>
                      ) : (
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
                          <div className="action-row">
                            <button className="primary-button" type="submit">Add step</button>
                            <button
                              className="ghost-button"
                              onClick={() => {
                                setIsStepCreateVisible(false);
                                setNewStepDraft(EMPTY_STEP_DRAFT);
                              }}
                              type="button"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}
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
        </div>
      </div>

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
                <p>Upload reusable cases in bulk. Action and Expected Result columns are converted into attached test steps automatically.</p>
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
                <span>Use new lines or the `|` character in Action and Expected Result to create multiple steps per test case.</span>
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
                        <th>Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 5).map((row, index) => (
                        <tr key={`${row.title}-${index}`}>
                          <td>{row.title}</td>
                          <td>{countImportedSteps(row)}</td>
                          <td>{splitImportedStepValue(row.action)[0] || splitImportedStepValue(row.expected_result)[0] || "No step content supplied"}</td>
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

function EditableStepCard({
  step,
  isExpanded,
  canMoveUp,
  canMoveDown,
  onSave,
  onDelete,
  onToggle,
  onMoveUp,
  onMoveDown
}: {
  step: TestStep;
  isExpanded: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSave: (input: StepDraft) => void;
  onDelete: () => void;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
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
    <article className={isExpanded ? "step-card is-expanded" : "step-card"}>
      <button className="step-card-toggle" onClick={onToggle} type="button">
        <div className="step-card-summary">
          <strong>Step {step.step_order}</strong>
          <span>{draft.action || "No action written yet"}</span>
        </div>
        <span className="step-card-toggle-state">{isExpanded ? "Hide" : "Show"}</span>
      </button>

      {isExpanded ? (
        <div className="step-card-body">
          <FormField label="Action">
            <input value={draft.action} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))} />
          </FormField>
          <FormField label="Expected result">
            <textarea rows={3} value={draft.expected_result} onChange={(event) => setDraft((current) => ({ ...current, expected_result: event.target.value }))} />
          </FormField>
          <div className="action-row">
            <button className="ghost-button" disabled={!canMoveUp} onClick={onMoveUp} type="button">Move up</button>
            <button className="ghost-button" disabled={!canMoveDown} onClick={onMoveDown} type="button">Move down</button>
            <button className="primary-button" onClick={() => onSave(draft)} type="button">Save step</button>
            <button className="ghost-button danger" onClick={onDelete} type="button">Delete step</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function DraftStepCard({
  step,
  canMoveUp,
  canMoveDown,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown
}: {
  step: { step_order: number; action: string; expected_result: string };
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (input: StepDraft) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <article className="step-card is-expanded">
      <div className="step-card-top">
        <div className="step-card-summary">
          <strong>Step {step.step_order}</strong>
          <span>{step.action || step.expected_result || "Draft step details"}</span>
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
        <div className="action-row">
          <button className="ghost-button" disabled={!canMoveUp} onClick={onMoveUp} type="button">Move up</button>
          <button className="ghost-button" disabled={!canMoveDown} onClick={onMoveDown} type="button">Move down</button>
          <button className="ghost-button danger" onClick={onDelete} type="button">Delete step</button>
        </div>
      </div>
    </article>
  );
}
