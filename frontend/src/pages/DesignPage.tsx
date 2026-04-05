import { DragEvent, FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import { SuiteCasePicker } from "../components/SuiteCasePicker";
import { ToastMessage } from "../components/ToastMessage";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import type { AppType, ExecutionResult, Project, Requirement, TestCase, TestStep, TestSuite } from "../types";

type CaseDraft = {
  suite_id: string;
  title: string;
  description: string;
  priority: string;
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

type SuiteCaseEditorSectionKey = "case" | "steps" | "history";

type SuiteModalMode = "create" | "edit";

const DEFAULT_CASE_STATUS = "active";
const EMPTY_CASE_DRAFT: CaseDraft = {
  suite_id: "",
  title: "",
  description: "",
  priority: "3",
  status: DEFAULT_CASE_STATUS,
  requirement_id: ""
};
const EMPTY_STEP_DRAFT = {
  action: "",
  expected_result: ""
};

const createDefaultSuiteCaseSections = (): Record<SuiteCaseEditorSectionKey, boolean> => ({
  case: true,
  steps: true,
  history: false
});

const createDraftStepId = () =>
  globalThis.crypto?.randomUUID?.() || `suite-draft-step-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const normalizeDraftSteps = (steps: DraftTestStep[]) =>
  steps
    .map((step, index) => ({
      step_order: index + 1,
      action: step.action.trim(),
      expected_result: step.expected_result.trim()
    }))
    .filter((step) => step.action || step.expected_result);

export function DesignPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useState("");
  const [selectedSuiteId, setSelectedSuiteId] = useState("");
  const [selectedSuiteActionIds, setSelectedSuiteActionIds] = useState<string[]>([]);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [suiteSearchTerm, setSuiteSearchTerm] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isCreatingCase, setIsCreatingCase] = useState(false);
  const [isTestCaseEditorModalOpen, setIsTestCaseEditorModalOpen] = useState(false);
  const [isCreateExecutionModalOpen, setIsCreateExecutionModalOpen] = useState(false);
  const [executionName, setExecutionName] = useState("");
  const [suiteModalMode, setSuiteModalMode] = useState<SuiteModalMode>("create");
  const [isSuiteModalOpen, setIsSuiteModalOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<SuiteCaseEditorSectionKey, boolean>>(createDefaultSuiteCaseSections);
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
  const [isDeletingSelectedSuites, setIsDeletingSelectedSuites] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");

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
    queryKey: ["design-suites", appTypeId],
    queryFn: () => api.testSuites.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const testCasesQuery = useQuery({
    queryKey: ["design-test-cases", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const executionResultsQuery = useQuery({
    queryKey: ["design-case-results", appTypeId],
    queryFn: () => api.executionResults.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const allTestStepsQuery = useQuery({
    queryKey: ["design-all-test-steps", appTypeId],
    queryFn: () => api.testSteps.list(),
    enabled: Boolean(appTypeId)
  });
  const suiteMappingsQuery = useQuery({
    queryKey: ["suite-test-case-mappings", selectedSuiteId],
    queryFn: () => api.suiteTestCases.list({ suite_id: selectedSuiteId }),
    enabled: Boolean(selectedSuiteId)
  });
  const stepsQuery = useQuery({
    queryKey: ["design-test-steps", selectedTestCaseId],
    queryFn: () => api.testSteps.list({ test_case_id: selectedTestCaseId }),
    enabled: Boolean(selectedTestCaseId) && !isCreatingCase
  });

  const createSuiteMutation = useMutation({ mutationFn: api.testSuites.create });
  const updateSuiteMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ name: string; parent_id: string }> }) =>
      api.testSuites.update(id, input)
  });
  const assignSuiteCasesMutation = useMutation({
    mutationFn: ({ id, testCaseIds }: { id: string; testCaseIds: string[] }) => api.testSuites.assignTestCases(id, testCaseIds)
  });
  const reorderSuiteCasesMutation = useMutation({
    mutationFn: ({ suiteId, testCaseIds }: { suiteId: string; testCaseIds: string[] }) =>
      api.suiteTestCases.reorder(suiteId, testCaseIds)
  });
  const createTestCaseMutation = useMutation({ mutationFn: api.testCases.create });
  const updateTestCaseMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ app_type_id: string; suite_id: string; suite_ids: string[]; title: string; description: string; priority: number; status: string; requirement_id: string }> }) =>
      api.testCases.update(id, input)
  });
  const deleteTestCaseMutation = useMutation({ mutationFn: api.testCases.delete });
  const createStepMutation = useMutation({ mutationFn: api.testSteps.create });
  const updateStepMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ test_case_id: string; step_order: number; action: string; expected_result: string }> }) =>
      api.testSteps.update(id, input)
  });
  const reorderStepsMutation = useMutation({
    mutationFn: ({ testCaseId, stepIds }: { testCaseId: string; stepIds: string[] }) =>
      api.testSteps.reorder(testCaseId, stepIds)
  });
  const deleteStepMutation = useMutation({ mutationFn: api.testSteps.delete });
  const createExecutionMutation = useMutation({ mutationFn: api.executions.create });

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const requirements = requirementsQuery.data || [];
  const suites = suitesQuery.data || [];
  const allTestCases = testCasesQuery.data || [];
  const executionResults = executionResultsQuery.data || [];
  const allTestSteps = allTestStepsQuery.data || [];
  const suiteMappings = suiteMappingsQuery.data || [];
  const steps = stepsQuery.data || [];

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const [caseDraft, setCaseDraft] = useState<CaseDraft>(EMPTY_CASE_DRAFT);
  const [newStepDraft, setNewStepDraft] = useState(EMPTY_STEP_DRAFT);
  const [draftSteps, setDraftSteps] = useState<DraftTestStep[]>([]);
  const [stepDrafts, setStepDrafts] = useState<Record<string, StepDraft>>({});

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

  const suiteIds = useMemo(() => new Set(suites.map((suite) => suite.id)), [suites]);
  const appTypeCases = useMemo(
    () => allTestCases.filter((testCase) => (testCase.suite_ids || []).some((suiteId) => suiteIds.has(suiteId))),
    [allTestCases, suiteIds]
  );

  const suiteCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    appTypeCases.forEach((testCase) => {
      (testCase.suite_ids || []).forEach((suiteId) => {
        counts[suiteId] = (counts[suiteId] || 0) + 1;
      });
    });

    return counts;
  }, [appTypeCases]);
  const filteredSuites = useMemo(() => {
    const normalizedSearch = suiteSearchTerm.trim().toLowerCase();

    if (!normalizedSearch) {
      return suites;
    }

    return suites.filter((suite) => {
      const haystack = `${suite.name} ${suite.parent_id ? "nested" : "root"}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [suiteSearchTerm, suites]);

  const filteredCases = useMemo(() => {
    const suiteOrder = new Map(suiteMappings.map((mapping) => [mapping.test_case_id, mapping.sort_order]));
    const sourceCases = selectedSuiteId
      ? appTypeCases
          .filter((testCase) => (testCase.suite_ids || []).includes(selectedSuiteId))
          .slice()
          .sort((left, right) => {
            const leftOrder = suiteOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = suiteOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

            if (leftOrder !== rightOrder) {
              return leftOrder - rightOrder;
            }

            return left.title.localeCompare(right.title);
          })
      : appTypeCases;

    return sourceCases.filter((testCase) => {
      if (selectedSuiteId && !(testCase.suite_ids || []).includes(selectedSuiteId)) {
        return false;
      }

      if (statusFilter !== "all" && (testCase.status || DEFAULT_CASE_STATUS) !== statusFilter) {
        return false;
      }

      if (!searchTerm.trim()) {
        return true;
      }

      const haystack = `${testCase.title} ${testCase.description || ""}`.toLowerCase();
      return haystack.includes(searchTerm.trim().toLowerCase());
    });
  }, [appTypeCases, searchTerm, selectedSuiteId, statusFilter, suiteMappings]);

  const orderedSuiteCases = useMemo(() => {
    if (!selectedSuiteId) {
      return [];
    }

    const suiteOrder = new Map(suiteMappings.map((mapping) => [mapping.test_case_id, mapping.sort_order]));

    return appTypeCases
      .filter((testCase) => (testCase.suite_ids || []).includes(selectedSuiteId))
      .slice()
      .sort((left, right) => {
        const leftOrder = suiteOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = suiteOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        return left.title.localeCompare(right.title);
      });
  }, [appTypeCases, selectedSuiteId, suiteMappings]);

  const selectedProject = projects.find((project) => project.id === projectId) || null;
  const selectedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;
  const selectedSuite = suites.find((suite) => suite.id === selectedSuiteId) || null;
  const selectedTestCase = appTypeCases.find((testCase) => testCase.id === selectedTestCaseId) || null;
  const sortedSteps = useMemo(
    () => [...steps].sort((left, right) => left.step_order - right.step_order),
    [steps]
  );
  const displaySteps = useMemo(
    () =>
      isCreatingCase
        ? draftSteps.map((step, index) => ({
            id: step.id,
            test_case_id: selectedTestCaseId || "draft",
            step_order: index + 1,
            action: step.action,
            expected_result: step.expected_result
          }))
        : sortedSteps,
    [draftSteps, isCreatingCase, selectedTestCaseId, sortedSteps]
  );
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
    const scopedCaseIds = new Set(appTypeCases.map((testCase) => testCase.id));
    const counts: Record<string, number> = {};

    allTestSteps.forEach((step) => {
      if (!scopedCaseIds.has(step.test_case_id)) {
        return;
      }

      counts[step.test_case_id] = (counts[step.test_case_id] || 0) + 1;
    });

    return counts;
  }, [allTestSteps, appTypeCases]);
  const selectedHistory = selectedTestCase ? historyByCaseId[selectedTestCase.id] || [] : [];
  const executionTargetSuiteIds = useMemo(
    () => selectedSuiteActionIds,
    [selectedSuiteActionIds]
  );
  const executionTargetSuites = useMemo(
    () => suites.filter((suite) => executionTargetSuiteIds.includes(suite.id)),
    [executionTargetSuiteIds, suites]
  );
  const areAllFilteredSuitesSelected = Boolean(filteredSuites.length) && filteredSuites.every((suite) => selectedSuiteActionIds.includes(suite.id));

  useEffect(() => {
    if (selectedSuiteId && !suites.some((suite) => suite.id === selectedSuiteId)) {
      setSelectedSuiteId("");
      setSelectedTestCaseId("");
      setIsCreatingCase(false);
      setIsTestCaseEditorModalOpen(false);
    }
  }, [selectedSuiteId, suites]);

  useEffect(() => {
    setSelectedSuiteActionIds((current) => current.filter((suiteId) => suites.some((suite) => suite.id === suiteId)));
  }, [suites]);

  useEffect(() => {
    setSelectedTestCaseId("");
    setIsCreatingCase(false);
    setIsTestCaseEditorModalOpen(false);
    setDraftSteps([]);
    setExpandedSections(createDefaultSuiteCaseSections());
    setExpandedStepIds([]);
    setNewStepDraft(EMPTY_STEP_DRAFT);
  }, [selectedSuiteId]);

  useEffect(() => {
    setExpandedSections(createDefaultSuiteCaseSections());
    setNewStepDraft(EMPTY_STEP_DRAFT);

    if (isCreatingCase) {
      setExpandedStepIds([]);
      return;
    }

    setExpandedStepIds([]);
  }, [isCreatingCase, selectedTestCaseId]);

  useEffect(() => {
    if (!isCreatingCase) {
      return;
    }

    setExpandedStepIds(draftSteps.map((step) => step.id));
  }, [draftSteps, isCreatingCase]);

  useEffect(() => {
    if (isCreatingCase) {
      return;
    }

    setExpandedStepIds((current) => {
      const validIds = current.filter((id) => sortedSteps.some((step) => step.id === id));

      if (!validIds.length && sortedSteps.length) {
        return sortedSteps.map((step) => step.id);
      }

      return validIds;
    });
  }, [isCreatingCase, sortedSteps]);

  useEffect(() => {
    if (isCreatingCase) {
      return;
    }

    if (!filteredCases.length) {
      setSelectedTestCaseId("");
      return;
    }

    if (!filteredCases.some((testCase) => testCase.id === selectedTestCaseId)) {
      setSelectedTestCaseId(filteredCases[0].id);
    }
  }, [filteredCases, isCreatingCase, selectedTestCaseId]);

  useEffect(() => {
    if (isCreatingCase || !selectedTestCase) {
      setCaseDraft({
        ...EMPTY_CASE_DRAFT,
        suite_id: selectedSuiteId || suites[0]?.id || ""
      });
      return;
    }

    setCaseDraft({
      suite_id: selectedTestCase.suite_ids?.[0] || selectedTestCase.suite_id || "",
      title: selectedTestCase.title,
      description: selectedTestCase.description || "",
      priority: String(selectedTestCase.priority ?? 3),
      status: selectedTestCase.status || DEFAULT_CASE_STATUS,
      requirement_id: selectedTestCase.requirement_id || ""
    });
  }, [isCreatingCase, selectedSuiteId, selectedTestCase, suites]);

  useEffect(() => {
    const drafts: Record<string, StepDraft> = {};
    sortedSteps.forEach((step) => {
      drafts[step.id] = {
        action: step.action || "",
        expected_result: step.expected_result || ""
      };
    });
    setStepDrafts(drafts);
  }, [sortedSteps]);

  const updateCasesCache = (updater: (current: TestCase[]) => TestCase[]) => {
    queryClient.setQueryData<TestCase[]>(["design-test-cases", appTypeId], (current = []) => updater(current));
    queryClient.setQueryData<TestCase[]>(["global-test-cases", appTypeId], (current = []) => updater(current));
    queryClient.setQueryData<TestCase[]>(["test-cases"], (current = []) => updater(current));
  };

  const updateStepsCache = (testCaseId: string, updater: (current: TestStep[]) => TestStep[]) => {
    queryClient.setQueryData<TestStep[]>(["design-test-steps", testCaseId], (current = []) => updater(current));
    queryClient.setQueryData<TestStep[]>(["test-steps"], (current = []) => updater(current));
  };

  const refreshSuites = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["design-suites", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["test-suites"] }),
      queryClient.invalidateQueries({ queryKey: ["design-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["suite-test-case-mappings"] }),
      queryClient.invalidateQueries({ queryKey: ["test-cases"] }),
      queryClient.invalidateQueries({ queryKey: ["global-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["global-test-case-results", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["design-case-results", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["design-all-test-steps", appTypeId] })
    ]);
  };

  const closeTestCaseEditorModal = () => {
    setIsTestCaseEditorModalOpen(false);
    setExpandedSections(createDefaultSuiteCaseSections());
    setExpandedStepIds([]);
    setNewStepDraft(EMPTY_STEP_DRAFT);

    if (isCreatingCase) {
      setIsCreatingCase(false);
      setDraftSteps([]);
      setCaseDraft({
        ...EMPTY_CASE_DRAFT,
        suite_id: selectedSuiteId || suites[0]?.id || ""
      });
    }
  };

  const beginCreateCase = () => {
    setSelectedTestCaseId("");
    setIsCreatingCase(true);
    setDraftSteps([]);
    setCaseDraft({
      ...EMPTY_CASE_DRAFT,
      suite_id: selectedSuiteId || suites[0]?.id || ""
    });
    setExpandedSections(createDefaultSuiteCaseSections());
    setExpandedStepIds([]);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setIsTestCaseEditorModalOpen(true);
  };

  const openSelectedCaseEditor = () => {
    if (!selectedTestCase && !isCreatingCase) {
      return;
    }

    setIsCreatingCase(false);
    setIsTestCaseEditorModalOpen(true);
  };

  const handleProjectChange = (value: string) => {
    setProjectId(value);
    setAppTypeId("");
    setSelectedSuiteId("");
    setSelectedSuiteActionIds([]);
    setSelectedTestCaseId("");
    setSuiteSearchTerm("");
    setIsCreatingCase(false);
    setIsTestCaseEditorModalOpen(false);
    setIsCreateExecutionModalOpen(false);
    setExecutionName("");
    setExpandedSections(createDefaultSuiteCaseSections());
    setExpandedStepIds([]);
    setDraftSteps([]);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setMessage("");
  };

  const handleAppTypeChange = (value: string) => {
    setAppTypeId(value);
    setSelectedSuiteId("");
    setSelectedSuiteActionIds([]);
    setSelectedTestCaseId("");
    setSuiteSearchTerm("");
    setIsCreatingCase(false);
    setIsTestCaseEditorModalOpen(false);
    setIsCreateExecutionModalOpen(false);
    setExecutionName("");
    setSearchTerm("");
    setStatusFilter("all");
    setExpandedSections(createDefaultSuiteCaseSections());
    setExpandedStepIds([]);
    setDraftSteps([]);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setMessage("");
  };

  const handleSuiteSave = async (input: { name: string; parent_id?: string; selectedIds: string[] }) => {
    try {
      let suiteId = selectedSuiteId;

      if (suiteModalMode === "create") {
        const response = await createSuiteMutation.mutateAsync({
          app_type_id: appTypeId,
          name: input.name,
          parent_id: input.parent_id || undefined
        });
        suiteId = response.id;
      } else if (selectedSuite) {
        await updateSuiteMutation.mutateAsync({
          id: selectedSuite.id,
          input: {
            name: input.name,
            parent_id: input.parent_id || undefined
          }
        });
      }

      if (suiteId && (suiteModalMode === "edit" || input.selectedIds.length)) {
        await assignSuiteCasesMutation.mutateAsync({
          id: suiteId,
          testCaseIds: input.selectedIds
        });
      }

      setSelectedSuiteId(suiteId);
      setIsSuiteModalOpen(false);
      showSuccess(suiteModalMode === "create" ? "Suite created." : "Suite updated.");
      await refreshSuites();
    } catch (error) {
      showError(error, "Unable to save suite");
    }
  };

  const handleSaveTestCase = async () => {
    const suiteId = caseDraft.suite_id || selectedSuiteId || suites[0]?.id || "";

    if (!suiteId) {
      setMessageTone("error");
      setMessage("Create a suite first before saving test cases.");
      return;
    }

    try {
      if (isCreatingCase || !selectedTestCase) {
        const response = await createTestCaseMutation.mutateAsync({
          app_type_id: appTypeId,
          suite_ids: [suiteId],
          title: caseDraft.title,
          description: caseDraft.description || undefined,
          priority: Number(caseDraft.priority || 3),
          status: caseDraft.status || DEFAULT_CASE_STATUS,
          requirement_id: caseDraft.requirement_id || undefined,
          requirement_ids: caseDraft.requirement_id ? [caseDraft.requirement_id] : [],
          steps: normalizeDraftSteps(draftSteps)
        });

        const optimisticCase: TestCase = {
          id: response.id,
          suite_id: suiteId,
          suite_ids: [suiteId],
          title: caseDraft.title,
          description: caseDraft.description || null,
          priority: Number(caseDraft.priority || 3),
          status: caseDraft.status || DEFAULT_CASE_STATUS,
          requirement_id: caseDraft.requirement_id || null
        };

        updateCasesCache((current) => [optimisticCase, ...current]);
        setSelectedSuiteId(suiteId);
        setSelectedTestCaseId(response.id);
        setIsCreatingCase(false);
        setDraftSteps([]);
        showSuccess("Test case created.");
      } else {
        await updateTestCaseMutation.mutateAsync({
          id: selectedTestCase.id,
          input: {
            app_type_id: appTypeId,
            suite_ids: selectedTestCase.suite_ids?.length
              ? [suiteId, ...selectedTestCase.suite_ids.filter((id) => id !== suiteId)]
              : [suiteId],
            title: caseDraft.title,
            description: caseDraft.description,
            priority: Number(caseDraft.priority || 3),
            status: caseDraft.status,
            requirement_id: caseDraft.requirement_id || undefined
          }
        });

        updateCasesCache((current) =>
          current.map((testCase) =>
            testCase.id === selectedTestCase.id
              ? {
                ...testCase,
                  suite_id: suiteId,
                  suite_ids: testCase.suite_ids?.length
                    ? [suiteId, ...testCase.suite_ids.filter((id) => id !== suiteId)]
                    : [suiteId],
                  title: caseDraft.title,
                  description: caseDraft.description || null,
                  priority: Number(caseDraft.priority || 3),
                  status: caseDraft.status,
                  requirement_id: caseDraft.requirement_id || null
                }
              : testCase
          )
        );

        showSuccess("Test case updated.");
      }

      await refreshSuites();
    } catch (error) {
      showError(error, "Unable to save test case");
    }
  };

  const handleDeleteSelectedSuites = async () => {
    const selectedSuites = suites.filter((suite) => selectedSuiteActionIds.includes(suite.id));

    if (!selectedSuites.length) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedSuites.length} suite${selectedSuites.length === 1 ? "" : "s"}? Linked test cases will be kept, but their suite mappings will be removed.`
    );

    if (!confirmed) {
      return;
    }

    setIsDeletingSelectedSuites(true);

    try {
      const results = await Promise.allSettled(selectedSuites.map((suite) => api.testSuites.delete(suite.id)));
      const deletedIds = selectedSuites
        .filter((_, index) => results[index]?.status === "fulfilled")
        .map((suite) => suite.id);
      const failedResults = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

      setSelectedSuiteActionIds((current) => current.filter((id) => !deletedIds.includes(id)));

      if (deletedIds.includes(selectedSuiteId)) {
        setSelectedSuiteId("");
        setSelectedTestCaseId("");
        setIsCreatingCase(false);
        setIsTestCaseEditorModalOpen(false);
      }

      if (deletedIds.length) {
        await refreshSuites();
      }

      if (!failedResults.length) {
        showSuccess(`${deletedIds.length} suite${deletedIds.length === 1 ? "" : "s"} deleted. Linked test cases remain reusable.`);
        return;
      }

      const firstError = failedResults[0]?.reason;
      const detail = firstError instanceof Error ? ` ${firstError.message}` : "";

      if (deletedIds.length) {
        setMessageTone("error");
        setMessage(`${deletedIds.length} suite${deletedIds.length === 1 ? "" : "s"} deleted, but ${failedResults.length} failed.${detail}`);
        return;
      }

      showError(firstError, "Unable to delete selected suites");
    } finally {
      setIsDeletingSelectedSuites(false);
    }
  };

  const handleCreateExecution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session?.user.id) {
      setMessageTone("error");
      setMessage("You need an active session before creating an execution.");
      return;
    }

    if (!projectId || !appTypeId || !executionTargetSuiteIds.length) {
      setMessageTone("error");
      setMessage("Select at least one suite in the current scope before creating an execution.");
      return;
    }

    try {
      const response = await createExecutionMutation.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId,
        suite_ids: executionTargetSuiteIds,
        name: executionName.trim() || undefined,
        created_by: session.user.id
      });

      setExecutionName("");
      setIsCreateExecutionModalOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["executions"] }),
        queryClient.invalidateQueries({ queryKey: ["executions", projectId] })
      ]);
      navigate(`/executions?execution=${response.id}`);
    } catch (error) {
      showError(error, "Unable to create execution");
    }
  };

  const handleDeleteTestCase = async () => {
    if (!selectedTestCase || !window.confirm(`Delete test case "${selectedTestCase.title}"? This will remove its steps and mappings.`)) {
      return;
    }

    try {
      await deleteTestCaseMutation.mutateAsync(selectedTestCase.id);
      updateCasesCache((current) => current.filter((testCase) => testCase.id !== selectedTestCase.id));
      queryClient.removeQueries({ queryKey: ["design-test-steps", selectedTestCase.id] });
      setSelectedTestCaseId("");
      setIsCreatingCase(false);
      setIsTestCaseEditorModalOpen(false);
      setDraftSteps([]);
      setExpandedStepIds([]);
      showSuccess("Test case deleted.");
      await refreshSuites();
    } catch (error) {
      showError(error, "Unable to delete test case");
    }
  };

  const handleCreateStep = async () => {
    const normalizedDraft = {
      action: newStepDraft.action.trim(),
      expected_result: newStepDraft.expected_result.trim()
    };

    if (!normalizedDraft.action && !normalizedDraft.expected_result) {
      setMessageTone("error");
      setMessage("Add an action or expected result before creating a step.");
      return;
    }

    if (isCreatingCase) {
      const draftId = createDraftStepId();
      setDraftSteps((current) => [...current, { id: draftId, ...normalizedDraft }]);
      setExpandedStepIds((current) => [...new Set([...current, draftId])]);
      setNewStepDraft(EMPTY_STEP_DRAFT);
      showSuccess("Draft step added to the new test case.");
      return;
    }

    if (!selectedTestCase) {
      setMessageTone("error");
      setMessage("Select a test case before adding steps.");
      return;
    }

    try {
      const nextStepOrder = (sortedSteps[sortedSteps.length - 1]?.step_order || 0) + 1;
      const response = await createStepMutation.mutateAsync({
        test_case_id: selectedTestCase.id,
        step_order: nextStepOrder,
        action: normalizedDraft.action,
        expected_result: normalizedDraft.expected_result
      });

      const optimisticStep: TestStep = {
        id: response.id,
        test_case_id: selectedTestCase.id,
        step_order: nextStepOrder,
        action: normalizedDraft.action || null,
        expected_result: normalizedDraft.expected_result || null
      };

      updateStepsCache(selectedTestCase.id, (current) => [...current, optimisticStep]);
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setExpandedStepIds((current) => [...new Set([...current, response.id])]);
      showSuccess("Step added.");
      await queryClient.invalidateQueries({ queryKey: ["design-all-test-steps", appTypeId] });
    } catch (error) {
      showError(error, "Unable to add step");
    }
  };

  const handleUpdateStep = async (stepId: string, draftOverride?: StepDraft) => {
    const draft = draftOverride || stepDrafts[stepId];
    const step = sortedSteps.find((item) => item.id === stepId);

    if (!draft || !step) {
      return;
    }

    try {
      await updateStepMutation.mutateAsync({
        id: stepId,
        input: {
          test_case_id: step.test_case_id,
          step_order: step.step_order,
          action: draft.action,
          expected_result: draft.expected_result
        }
      });

      updateStepsCache(step.test_case_id, (current) =>
        current.map((item) =>
          item.id === stepId
            ? {
                ...item,
                step_order: step.step_order,
                action: draft.action || null,
                expected_result: draft.expected_result || null
              }
            : item
        )
      );

      showSuccess("Step updated.");
      await queryClient.invalidateQueries({ queryKey: ["design-all-test-steps", appTypeId] });
    } catch (error) {
      showError(error, "Unable to update step");
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (isCreatingCase) {
      setDraftSteps((current) => current.filter((step) => step.id !== stepId));
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Draft step removed.");
      return;
    }

    if (!selectedTestCase) {
      return;
    }

    try {
      await deleteStepMutation.mutateAsync(stepId);
      updateStepsCache(selectedTestCase.id, (current) =>
        current
          .filter((step) => step.id !== stepId)
          .map((step, index) => ({ ...step, step_order: index + 1 }))
      );
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Step deleted.");
      await queryClient.invalidateQueries({ queryKey: ["design-all-test-steps", appTypeId] });
    } catch (error) {
      showError(error, "Unable to delete step");
    }
  };

  const handleReorderStep = async (stepId: string, direction: "up" | "down") => {
    if (!selectedTestCase) {
      return;
    }

    const currentIndex = sortedSteps.findIndex((step) => step.id === stepId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= sortedSteps.length) {
      return;
    }

    const reordered = [...sortedSteps];
    const [movedStep] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, movedStep);

    const normalized = reordered.map((step, index) => ({
      ...step,
      step_order: index + 1
    }));

    try {
      await reorderStepsMutation.mutateAsync({
        testCaseId: selectedTestCase.id,
        stepIds: normalized.map((step) => step.id)
      });

      updateStepsCache(selectedTestCase.id, () => normalized);
      setExpandedStepIds((current) => [...new Set([...current, stepId])]);
      showSuccess("Step order updated.");
      await queryClient.invalidateQueries({ queryKey: ["design-all-test-steps", appTypeId] });
    } catch (error) {
      showError(error, "Unable to reorder steps");
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

  const handleReorderCases = async (fromCaseId: string, toCaseId: string) => {
    if (!selectedSuiteId || fromCaseId === toCaseId) {
      return;
    }

    const reordered = [...orderedSuiteCases];
    const fromIndex = reordered.findIndex((testCase) => testCase.id === fromCaseId);
    const toIndex = reordered.findIndex((testCase) => testCase.id === toCaseId);

    if (fromIndex === -1 || toIndex === -1) {
      return;
    }

    const [movedCase] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, movedCase);

    try {
      await reorderSuiteCasesMutation.mutateAsync({
        suiteId: selectedSuiteId,
        testCaseIds: reordered.map((testCase) => testCase.id)
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["design-test-cases", appTypeId] }),
        queryClient.invalidateQueries({ queryKey: ["suite-test-case-mappings", selectedSuiteId] })
      ]);
      showSuccess("Test case order updated.");
    } catch (error) {
      showError(error, "Unable to reorder test cases");
    }
  };

  const isDesignLoading =
    projectsQuery.isLoading ||
    appTypesQuery.isLoading ||
    suitesQuery.isLoading ||
    testCasesQuery.isLoading ||
    executionResultsQuery.isLoading ||
    allTestStepsQuery.isLoading ||
    (Boolean(selectedSuiteId) && suiteMappingsQuery.isLoading);
  const designMetrics = useMemo(() => {
    const casesWithRequirements = appTypeCases.filter((testCase) => testCase.requirement_id || testCase.requirement_ids?.length).length;
    const casesWithHistory = appTypeCases.filter((testCase) => (historyByCaseId[testCase.id] || []).length > 0).length;
    const totalSteps = appTypeCases.reduce((total, testCase) => total + (stepCountByCaseId[testCase.id] || 0), 0);

    return {
      totalSuites: suites.length,
      totalCases: appTypeCases.length,
      casesWithRequirements,
      casesWithHistory,
      totalSteps
    };
  }, [appTypeCases, historyByCaseId, stepCountByCaseId, suites.length]);

  return (
    <div className="page-content page-content--library-full">
      <PageHeader
        eyebrow="Test Design"
        title="Test Suites"
        actions={
          <>
            <button className="ghost-button" disabled={!appTypeId || !suites.length} onClick={beginCreateCase} type="button">
              New Test Case
            </button>
            <button
              className="primary-button"
              disabled={!appTypeId}
              onClick={() => {
                setSuiteModalMode("create");
                setIsSuiteModalOpen(true);
              }}
              type="button"
            >
              Create Suite
            </button>
          </>
        }
      />

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={handleAppTypeChange}
        onProjectChange={handleProjectChange}
        projectId={projectId}
        projects={projects}
      />

      <div className="metric-strip">
        <div className="mini-card">
          <strong>{designMetrics.totalSuites}</strong>
          <span>Suites in this app type</span>
        </div>
        <div className="mini-card">
          <strong>{designMetrics.totalCases}</strong>
          <span>Reusable cases in scope</span>
        </div>
        <div className="mini-card">
          <strong>{designMetrics.totalSteps}</strong>
          <span>Defined steps across cases</span>
        </div>
        <div className="mini-card">
          <strong>{designMetrics.casesWithHistory}</strong>
          <span>Cases with execution history</span>
        </div>
      </div>

      <div className="test-case-workspace suite-design-workspace">
        <div className="test-case-sidebar suite-design-sidebar">
          <SuiteSidebar
            suites={filteredSuites}
            activeSuiteId={selectedSuiteId}
            counts={suiteCounts}
            suiteSearchTerm={suiteSearchTerm}
            selectedSuiteActionIds={selectedSuiteActionIds}
            areAllVisibleSuitesSelected={areAllFilteredSuitesSelected}
            onSelectSuite={(suiteId) => setSelectedSuiteId((current) => (current === suiteId ? "" : suiteId))}
            onSuiteSearchChange={setSuiteSearchTerm}
            onToggleSuiteSelection={(suiteId) =>
              setSelectedSuiteActionIds((current) =>
                current.includes(suiteId) ? current.filter((id) => id !== suiteId) : [...new Set([...current, suiteId])]
              )
            }
            onSelectAllVisibleSuites={() =>
              setSelectedSuiteActionIds((current) => [...new Set([...current, ...filteredSuites.map((suite) => suite.id)])])
            }
            onClearSuiteSelection={() => setSelectedSuiteActionIds([])}
            onCreateSuite={() => {
              setSuiteModalMode("create");
              setIsSuiteModalOpen(true);
            }}
            onEditSuite={() => {
              setSuiteModalMode("edit");
              setIsSuiteModalOpen(true);
            }}
            onDeleteSelectedSuites={() => void handleDeleteSelectedSuites()}
            onCreateExecution={() => setIsCreateExecutionModalOpen(true)}
            isLoading={suitesQuery.isLoading && Boolean(appTypeId)}
            selectedAppType={selectedAppType}
            selectedSuite={selectedSuite}
            canCreateSuite={Boolean(appTypeId)}
            canCreateExecution={Boolean(projectId && appTypeId && executionTargetSuiteIds.length && session?.user.id)}
            selectedSuiteCount={selectedSuiteActionIds.length}
            isDeletingSelectedSuites={isDeletingSelectedSuites}
            hasSuiteSearchResults={Boolean(filteredSuites.length)}
            hasAnySuites={Boolean(suites.length)}
          />
        </div>

        <div className="test-case-editor-column suite-design-main">
          <TestCaseList
            cases={filteredCases}
            activeCaseId={selectedTestCaseId}
            searchTerm={searchTerm}
            statusFilter={statusFilter}
            selectedSuite={selectedSuite}
            isLoading={isDesignLoading}
            historyByCaseId={historyByCaseId}
            requirements={requirements}
            stepCountByCaseId={stepCountByCaseId}
            onSearch={setSearchTerm}
            onStatusFilter={setStatusFilter}
            onSelectCase={(testCaseId) => {
              setSelectedTestCaseId(testCaseId);
              setIsCreatingCase(false);
            }}
            onCreateCase={beginCreateCase}
            onOpenCaseEditor={openSelectedCaseEditor}
            canOpenCaseEditor={Boolean(selectedTestCaseId) || isCreatingCase}
            onReorderCases={handleReorderCases}
          />
        </div>
      </div>

      {isTestCaseEditorModalOpen ? (
        <SuiteCaseEditorModal
          appType={selectedAppType}
          caseDraft={caseDraft}
          createPending={createTestCaseMutation.isPending}
          deletePending={deleteTestCaseMutation.isPending}
          displaySteps={displaySteps}
          draftSteps={draftSteps}
          expandedSections={expandedSections}
          expandedStepIds={expandedStepIds}
          history={selectedHistory}
          isCreatingCase={isCreatingCase}
          isLoadingSteps={stepsQuery.isLoading}
          newStepDraft={newStepDraft}
          onCaseDraftChange={setCaseDraft}
          onClose={closeTestCaseEditorModal}
          onCreateStep={() => void handleCreateStep()}
          onDeleteStep={(stepId) => void handleDeleteStep(stepId)}
          onDeleteTestCase={() => void handleDeleteTestCase()}
          onDraftStepChange={handleUpdateDraftStep}
          onDraftStepMove={(stepId, direction) => handleReorderDraftStep(stepId, direction)}
          onExpandAllSteps={() => setExpandedStepIds(displaySteps.map((step) => step.id))}
          onCollapseAllSteps={() => setExpandedStepIds([])}
          onNewStepDraftChange={setNewStepDraft}
          onSaveTestCase={() => void handleSaveTestCase()}
          onStepMove={(stepId, direction) => void handleReorderStep(stepId, direction)}
          onStepSave={(stepId, draft) => void handleUpdateStep(stepId, draft)}
          onToggleSection={(section) => setExpandedSections((current) => ({ ...current, [section]: !current[section] }))}
          onToggleStep={(stepId) =>
            setExpandedStepIds((current) =>
              current.includes(stepId) ? current.filter((id) => id !== stepId) : [...current, stepId]
            )
          }
          project={selectedProject}
          requirements={requirements}
          selectedSuite={selectedSuite}
          selectedTestCase={selectedTestCase}
          stepDrafts={stepDrafts}
          suites={suites}
          updatePending={updateTestCaseMutation.isPending || updateStepMutation.isPending}
        />
      ) : null}

      {isCreateExecutionModalOpen ? (
        <SuiteExecutionModal
          canCreateExecution={Boolean(projectId && appTypeId && executionTargetSuiteIds.length && session?.user.id)}
          executionName={executionName}
          isSubmitting={createExecutionMutation.isPending}
          onClose={() => {
            setIsCreateExecutionModalOpen(false);
            setExecutionName("");
          }}
          onExecutionNameChange={setExecutionName}
          onRemoveSuite={(suiteId) =>
            setSelectedSuiteActionIds((current) => current.filter((id) => id !== suiteId))
          }
          onSubmit={handleCreateExecution}
          scopeSuiteCount={suites.length}
          selectedAppType={selectedAppType?.name || ""}
          selectedProject={selectedProject?.name || ""}
          suites={executionTargetSuites}
        />
      ) : null}

      {isSuiteModalOpen ? (
        <SuiteModal
          key={`${suiteModalMode}-${selectedSuite?.id || "new"}`}
          mode={suiteModalMode}
          suite={selectedSuite}
          suites={suites}
          appTypeCases={allTestCases}
          selectedCaseIds={suiteModalMode === "edit" ? orderedSuiteCases.map((testCase) => testCase.id) : []}
          onClose={() => setIsSuiteModalOpen(false)}
          onSubmit={handleSuiteSave}
          isSaving={createSuiteMutation.isPending || updateSuiteMutation.isPending || assignSuiteCasesMutation.isPending}
        />
      ) : null}
    </div>
  );
}

function SuiteSidebar({
  actions,
  suites,
  activeSuiteId,
  counts,
  suiteSearchTerm,
  selectedSuiteActionIds,
  areAllVisibleSuitesSelected,
  onSelectSuite,
  onSuiteSearchChange,
  onToggleSuiteSelection,
  onSelectAllVisibleSuites,
  onClearSuiteSelection,
  onCreateSuite,
  onEditSuite,
  onDeleteSelectedSuites,
  onCreateExecution,
  isLoading,
  selectedAppType,
  selectedSuite,
  canCreateSuite,
  canCreateExecution,
  selectedSuiteCount,
  isDeletingSelectedSuites,
  hasSuiteSearchResults,
  hasAnySuites
}: {
  actions?: ReactNode;
  suites: TestSuite[];
  activeSuiteId: string;
  counts: Record<string, number>;
  suiteSearchTerm: string;
  selectedSuiteActionIds: string[];
  areAllVisibleSuitesSelected: boolean;
  onSelectSuite: (suiteId: string) => void;
  onSuiteSearchChange: (value: string) => void;
  onToggleSuiteSelection: (suiteId: string) => void;
  onSelectAllVisibleSuites: () => void;
  onClearSuiteSelection: () => void;
  onCreateSuite: () => void;
  onEditSuite: () => void;
  onDeleteSelectedSuites: () => void;
  onCreateExecution: () => void;
  isLoading: boolean;
  selectedAppType: AppType | null;
  selectedSuite: TestSuite | null;
  canCreateSuite: boolean;
  canCreateExecution: boolean;
  selectedSuiteCount: number;
  isDeletingSelectedSuites: boolean;
  hasSuiteSearchResults: boolean;
  hasAnySuites: boolean;
}) {
  return (
    <Panel
      className="execution-panel suite-design-panel suite-design-panel--list"
      actions={actions}
      title="Suites"
      subtitle={selectedAppType ? `${selectedAppType.name} · ${selectedAppType.type}` : "Select a project and app type first."}
    >
      <div className="suite-design-panel-stack">
        <div className="design-sidebar-actions">
          <button className="primary-button" disabled={!canCreateSuite} onClick={onCreateSuite} type="button">Create Suite</button>
          <button className="ghost-button" disabled={!selectedSuite} onClick={onEditSuite} type="button">Edit Suite</button>
          <button className="ghost-button" disabled={!canCreateExecution} onClick={onCreateExecution} type="button">Create Execution</button>
        </div>

        <div className="design-list-toolbar suite-sidebar-toolbar">
          <input
            aria-label="Search suites"
            placeholder="Search suites"
            value={suiteSearchTerm}
            onChange={(event) => onSuiteSearchChange(event.target.value)}
          />
          <button className="ghost-button" disabled={!suites.length || areAllVisibleSuitesSelected} onClick={onSelectAllVisibleSuites} type="button">
            Select all visible
          </button>
          <button className="ghost-button" disabled={!selectedSuiteActionIds.length} onClick={onClearSuiteSelection} type="button">
            Clear selection
          </button>
          <button
            className="ghost-button danger"
            disabled={!selectedSuiteActionIds.length || isDeletingSelectedSuites}
            onClick={onDeleteSelectedSuites}
            type="button"
          >
            {isDeletingSelectedSuites ? "Deleting…" : `Delete selected${selectedSuiteActionIds.length ? ` (${selectedSuiteActionIds.length})` : ""}`}
          </button>
        </div>

        {selectedSuiteCount ? (
          <div className="detail-summary suite-selection-summary">
            <strong>{selectedSuiteCount} suite{selectedSuiteCount === 1 ? "" : "s"} selected for bulk actions</strong>
            <span>Checkbox selections power bulk delete and execution creation. Click a card body to keep curating one suite at a time.</span>
          </div>
        ) : null}

        {selectedSuite ? (
          <div className="detail-summary suite-workspace-card">
            <strong>{selectedSuite.name}</strong>
            <span>{selectedSuite.parent_id ? "Nested suite" : "Root suite"} · {counts[selectedSuite.id] || 0} mapped cases</span>
            <span>Use the workspace to review scope, open a case editor, or restructure suite membership.</span>
          </div>
        ) : null}

        {isLoading ? <div className="empty-state compact">Loading suites…</div> : null}
        {!isLoading && !hasAnySuites ? (
          <div className="empty-state compact">
            <div>No suites yet. Create your first suite to start organizing reusable cases.</div>
            <button className="primary-button" disabled={!canCreateSuite} onClick={onCreateSuite} type="button">Create first suite</button>
          </div>
        ) : null}
        {!isLoading && hasAnySuites && !hasSuiteSearchResults ? <div className="empty-state compact">No suites match the current search.</div> : null}

        <div className="suite-design-panel-scroll suite-sidebar-list">
          {suites.map((suite) => (
            <button
              key={suite.id}
              className={[
                "record-card tile-card test-suite-card",
                activeSuiteId === suite.id ? "is-active" : "",
                selectedSuiteActionIds.includes(suite.id) ? "is-marked-for-delete" : ""
              ].filter(Boolean).join(" ")}
              onClick={() => onSelectSuite(suite.id)}
              type="button"
            >
              <div className="tile-card-main">
                <div className="tile-card-header">
                  <div className="record-card-icon test-suite">TS</div>
                  <div className="tile-card-title-group">
                    <strong>{suite.name}</strong>
                    <span className="tile-card-kicker">{suite.parent_id ? "Nested suite" : "Root suite"}</span>
                  </div>
                  <span className="object-type-badge test-suite">Suite</span>
                </div>
                <p className="tile-card-description">{selectedAppType ? `${selectedAppType.name} workspace suite` : "No app type selected"}</p>
                <label className="checkbox-field suite-card-action-checkbox" onClick={(event) => event.stopPropagation()}>
                  <input
                    checked={selectedSuiteActionIds.includes(suite.id)}
                    onChange={() => onToggleSuiteSelection(suite.id)}
                    type="checkbox"
                  />
                  Select suite
                </label>
              </div>
              <span className="count-pill">{counts[suite.id] || 0}</span>
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function TestCaseList({
  actions,
  cases,
  activeCaseId,
  searchTerm,
  statusFilter,
  selectedSuite,
  isLoading,
  historyByCaseId,
  requirements,
  stepCountByCaseId,
  onSearch,
  onStatusFilter,
  onSelectCase,
  onCreateCase,
  onOpenCaseEditor,
  canOpenCaseEditor,
  onReorderCases
}: {
  actions?: ReactNode;
  cases: TestCase[];
  activeCaseId: string;
  searchTerm: string;
  statusFilter: string;
  selectedSuite: TestSuite | null;
  isLoading: boolean;
  historyByCaseId: Record<string, ExecutionResult[]>;
  requirements: Requirement[];
  stepCountByCaseId: Record<string, number>;
  onSearch: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onSelectCase: (testCaseId: string) => void;
  onCreateCase: () => void;
  onOpenCaseEditor: () => void;
  canOpenCaseEditor: boolean;
  onReorderCases: (fromCaseId: string, toCaseId: string) => void;
}) {
  const [draggedCaseId, setDraggedCaseId] = useState("");
  const casesWithRequirements = cases.filter((testCase) => testCase.requirement_id || testCase.requirement_ids?.length).length;
  const casesWithHistory = cases.filter((testCase) => (historyByCaseId[testCase.id] || []).length > 0).length;

  return (
    <Panel
      className="execution-panel suite-design-panel suite-design-panel--cases"
      actions={actions}
      title="Test Case Workspace"
      subtitle={selectedSuite ? `Curated reusable cases inside ${selectedSuite.name}.` : "Showing all reusable cases for the current app type."}
    >
      <div className="suite-design-panel-stack">
        <div className="metric-strip compact">
          <div className="mini-card">
            <strong>{cases.length}</strong>
            <span>Visible cases</span>
          </div>
          <div className="mini-card">
            <strong>{casesWithRequirements}</strong>
            <span>Requirement-linked</span>
          </div>
          <div className="mini-card">
            <strong>{casesWithHistory}</strong>
            <span>Have execution history</span>
          </div>
          <div className="mini-card">
            <strong>{selectedSuite ? "Ordered" : "Library"}</strong>
            <span>{selectedSuite ? "Drag cards to reorder the suite" : "Open any case in the editor modal"}</span>
          </div>
        </div>

        <div className="design-list-toolbar test-case-catalog-toolbar">
          <input placeholder="Search title or description" value={searchTerm} onChange={(event) => onSearch(event.target.value)} />
          <select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">active</option>
            <option value="draft">draft</option>
            <option value="ready">ready</option>
          </select>
          <button className="primary-button" onClick={onCreateCase} type="button">New Test Case</button>
          <button className="ghost-button" disabled={!canOpenCaseEditor} onClick={onOpenCaseEditor} type="button">Open Case Editor</button>
        </div>

        {selectedSuite ? (
          <div className="detail-summary suite-workspace-card">
            <strong>{selectedSuite.name}</strong>
            <span>Cases stay ordered inside the suite, while each case remains reusable elsewhere.</span>
          </div>
        ) : null}

        {isLoading ? <div className="empty-state compact">Loading test cases…</div> : null}
        {!isLoading && !cases.length ? <div className="empty-state compact">No test cases match this scope yet.</div> : null}

        <div className="suite-design-panel-scroll test-case-library-scroll">
          {cases.map((testCase) => {
            const history = (historyByCaseId[testCase.id] || []).slice(0, 10);
            const latest = history[0];
            const requirement = requirements.find((item) => (testCase.requirement_ids || [testCase.requirement_id]).includes(item.id));
            const stepCount = stepCountByCaseId[testCase.id] || 0;

            return (
              <button
                key={testCase.id}
                className={[
                  "record-card tile-card test-case-card test-case-catalog-card suite-case-workspace-card",
                  activeCaseId === testCase.id ? "is-active" : ""
                ].filter(Boolean).join(" ")}
                onClick={() => onSelectCase(testCase.id)}
                draggable={Boolean(selectedSuite)}
                onDragStart={() => setDraggedCaseId(testCase.id)}
                onDragOver={(event: DragEvent<HTMLButtonElement>) => event.preventDefault()}
                onDrop={() => {
                  if (selectedSuite && draggedCaseId) {
                    void onReorderCases(draggedCaseId, testCase.id);
                  }
                  setDraggedCaseId("");
                }}
                onDragEnd={() => setDraggedCaseId("")}
                type="button"
              >
                {selectedSuite ? <span className="drag-handle" aria-hidden="true">::</span> : null}
                <div className="tile-card-main">
                  <div className="tile-card-header">
                    <div className="record-card-icon test-case">TC</div>
                    <div className="tile-card-title-group">
                      <strong>{testCase.title}</strong>
                      <span className="tile-card-kicker">{requirement?.title || "No requirement linked"}</span>
                    </div>
                    <span className="object-type-badge test-case">Reusable</span>
                  </div>
                  <p className="tile-card-description">{testCase.description || "No description yet for this test case."}</p>
                  <div className="tile-card-metrics">
                    <span className="tile-metric">Priority P{testCase.priority || 3}</span>
                    <span className="tile-metric">{stepCount} steps</span>
                    <span className="tile-metric">{(testCase.suite_ids || []).length || 0} suites</span>
                    <span className="tile-metric">{history.length} runs</span>
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
                </div>
                <StatusBadge value={latest?.status || testCase.status || DEFAULT_CASE_STATUS} />
              </button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function SuiteCaseEditorModal({
  project,
  appType,
  suites,
  selectedSuite,
  requirements,
  selectedTestCase,
  history,
  displaySteps,
  stepDrafts,
  caseDraft,
  newStepDraft,
  draftSteps,
  expandedSections,
  expandedStepIds,
  isCreatingCase,
  isLoadingSteps,
  createPending,
  updatePending,
  deletePending,
  onCaseDraftChange,
  onClose,
  onCreateStep,
  onDeleteStep,
  onDeleteTestCase,
  onDraftStepChange,
  onDraftStepMove,
  onExpandAllSteps,
  onCollapseAllSteps,
  onNewStepDraftChange,
  onSaveTestCase,
  onStepMove,
  onStepSave,
  onToggleSection,
  onToggleStep
}: {
  project: Project | null;
  appType: AppType | null;
  suites: TestSuite[];
  selectedSuite: TestSuite | null;
  requirements: Requirement[];
  selectedTestCase: TestCase | null;
  history: ExecutionResult[];
  displaySteps: TestStep[];
  stepDrafts: Record<string, StepDraft>;
  caseDraft: CaseDraft;
  newStepDraft: { action: string; expected_result: string };
  draftSteps: DraftTestStep[];
  expandedSections: Record<SuiteCaseEditorSectionKey, boolean>;
  expandedStepIds: string[];
  isCreatingCase: boolean;
  isLoadingSteps: boolean;
  createPending: boolean;
  updatePending: boolean;
  deletePending: boolean;
  onCaseDraftChange: (value: CaseDraft) => void;
  onClose: () => void;
  onCreateStep: () => void;
  onDeleteStep: (stepId: string) => void;
  onDeleteTestCase: () => void;
  onDraftStepChange: (stepId: string, input: StepDraft) => void;
  onDraftStepMove: (stepId: string, direction: "up" | "down") => void;
  onExpandAllSteps: () => void;
  onCollapseAllSteps: () => void;
  onNewStepDraftChange: (value: { action: string; expected_result: string }) => void;
  onSaveTestCase: () => void;
  onStepMove: (stepId: string, direction: "up" | "down") => void;
  onStepSave: (stepId: string, draft: StepDraft) => void;
  onToggleSection: (section: SuiteCaseEditorSectionKey) => void;
  onToggleStep: (stepId: string) => void;
}) {
  const selectedRequirement = requirements.find((item) => item.id === caseDraft.requirement_id) || null;
  const caseSectionSummary = isCreatingCase
    ? caseDraft.title.trim() || "Start the reusable case definition before saving it into the suite workspace."
    : selectedTestCase?.title || "Select a case from the workspace to edit it here.";
  const firstStepPreview = displaySteps[0]?.action || displaySteps[0]?.expected_result || "";
  const stepSectionSummary = firstStepPreview
    ? `Starts with: ${firstStepPreview}`
    : isCreatingCase
      ? "No draft steps added yet."
      : "No steps added yet for this case.";
  const historySectionSummary = history.length
    ? "Review the latest preserved execution evidence for this reusable case."
    : "No execution history has been recorded yet for this case.";

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-labelledby="suite-case-editor-title"
        aria-modal="true"
        className="modal-card suite-test-case-editor-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="suite-test-case-editor-header">
          <div className="suite-test-case-editor-title">
            <p className="eyebrow">Test Suites</p>
            <h3 id="suite-case-editor-title">{isCreatingCase ? "Create test case" : selectedTestCase ? `Edit ${selectedTestCase.title}` : "Test case editor"}</h3>
            <p>Use the modal for focused edits, then return to the three-panel suite workspace without losing your place.</p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">Close</button>
        </div>

        <div className="suite-test-case-editor-body">
          <div className="detail-summary">
            <strong>{selectedTestCase?.title || (isCreatingCase ? "New test case" : "No test case selected")}</strong>
            <span>{project?.name || "No project"} · {appType?.name || "No app type"}</span>
            <span>Suite context: {selectedSuite?.name || caseDraft.suite_id || "All suites"}</span>
          </div>

          <div className="metric-strip compact">
            <div className="mini-card">
              <strong>{selectedTestCase?.suite_ids?.length || (caseDraft.suite_id ? 1 : 0)}</strong>
              <span>Linked suites</span>
            </div>
            <div className="mini-card">
              <strong>{history.length}</strong>
              <span>Execution records</span>
            </div>
            <div className="mini-card">
              <strong>{displaySteps.length}</strong>
              <span>{isCreatingCase ? "Draft steps" : "Defined steps"}</span>
            </div>
            <div className="mini-card">
              <strong>{selectedRequirement ? "Linked" : "Open"}</strong>
              <span>{selectedRequirement?.title || "Requirement not linked yet"}</span>
            </div>
          </div>

          <div className="editor-accordion">
            <EditorAccordionSection
              countLabel={isCreatingCase ? "Draft" : caseDraft.status || DEFAULT_CASE_STATUS}
              isExpanded={expandedSections.case}
              onToggle={() => onToggleSection("case")}
              summary={caseSectionSummary}
              title={isCreatingCase ? "New test case" : "Selected test case"}
            >
              <form
                className="form-grid"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  onSaveTestCase();
                }}
              >
                <div className="record-grid">
                  <FormField label="Title" required>
                    <input
                      required
                      value={caseDraft.title}
                      onChange={(event) => onCaseDraftChange({ ...caseDraft, title: event.target.value })}
                    />
                  </FormField>
                  <FormField label="Suite">
                    <select value={caseDraft.suite_id} onChange={(event) => onCaseDraftChange({ ...caseDraft, suite_id: event.target.value })}>
                      {suites.map((suite) => (
                        <option key={suite.id} value={suite.id}>{suite.name}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Status">
                    <select value={caseDraft.status} onChange={(event) => onCaseDraftChange({ ...caseDraft, status: event.target.value })}>
                      <option value="active">active</option>
                      <option value="draft">draft</option>
                      <option value="ready">ready</option>
                      <option value="retired">retired</option>
                    </select>
                  </FormField>
                  <FormField label="Priority">
                    <input
                      min="1"
                      max="5"
                      type="number"
                      value={caseDraft.priority}
                      onChange={(event) => onCaseDraftChange({ ...caseDraft, priority: event.target.value || "3" })}
                    />
                  </FormField>
                  <FormField label="Requirement">
                    <select value={caseDraft.requirement_id} onChange={(event) => onCaseDraftChange({ ...caseDraft, requirement_id: event.target.value })}>
                      <option value="">No requirement</option>
                      {requirements.map((requirement) => (
                        <option key={requirement.id} value={requirement.id}>{requirement.title}</option>
                      ))}
                    </select>
                  </FormField>
                </div>

                <FormField label="Description">
                  <textarea
                    rows={4}
                    value={caseDraft.description}
                    onChange={(event) => onCaseDraftChange({ ...caseDraft, description: event.target.value })}
                  />
                </FormField>

                <div className="detail-summary">
                  <strong>{isCreatingCase ? "Create with steps attached" : "Live case definition"}</strong>
                  <span>{isCreatingCase ? `This test case will be saved with ${displaySteps.length} draft step${displaySteps.length === 1 ? "" : "s"} attached.` : "Edits here update the reusable test case while historical execution evidence stays preserved."}</span>
                </div>

                <div className="action-row">
                  <button className="primary-button" disabled={createPending || updatePending} type="submit">
                    {isCreatingCase ? (createPending ? "Creating…" : "Create test case") : (updatePending ? "Saving…" : "Save test case")}
                  </button>
                  {!isCreatingCase && selectedTestCase ? (
                    <button className="ghost-button danger" disabled={deletePending} onClick={onDeleteTestCase} type="button">Delete test case</button>
                  ) : null}
                </div>
              </form>
            </EditorAccordionSection>

            <EditorAccordionSection
              countLabel={`${displaySteps.length} step${displaySteps.length === 1 ? "" : "s"}`}
              isExpanded={expandedSections.steps}
              onToggle={() => onToggleSection("steps")}
              summary={stepSectionSummary}
              title={isCreatingCase ? "Draft steps" : "Test steps"}
            >
              <div className="step-editor step-editor--embedded">
                {!isCreatingCase && displaySteps.length ? (
                  <div className="action-row">
                    <button className="ghost-button" onClick={onExpandAllSteps} type="button">
                      Expand all
                    </button>
                    <button className="ghost-button" onClick={onCollapseAllSteps} type="button">
                      Collapse all
                    </button>
                  </div>
                ) : null}

                {!isCreatingCase && isLoadingSteps ? <div className="empty-state compact">Loading steps…</div> : null}
                {!displaySteps.length ? <div className="empty-state compact">{isCreatingCase ? "No draft steps yet. Add steps below before you save if this case needs guided execution." : "No steps yet for this test case."}</div> : null}

                <div className="step-list">
                  {isCreatingCase
                    ? draftSteps.map((step, index) => (
                        <DraftStepCard
                          canMoveDown={index < draftSteps.length - 1}
                          canMoveUp={index > 0}
                          key={step.id}
                          onChange={(input) => onDraftStepChange(step.id, input)}
                          onDelete={() => onDeleteStep(step.id)}
                          onMoveDown={() => onDraftStepMove(step.id, "down")}
                          onMoveUp={() => onDraftStepMove(step.id, "up")}
                          step={{ ...step, step_order: index + 1 }}
                        />
                      ))
                    : displaySteps.map((step, index) => (
                        <EditableStepCard
                          key={step.id}
                          canMoveDown={index < displaySteps.length - 1}
                          canMoveUp={index > 0}
                          isExpanded={expandedStepIds.includes(step.id)}
                          onDelete={() => onDeleteStep(step.id)}
                          onMoveDown={() => onStepMove(step.id, "down")}
                          onMoveUp={() => onStepMove(step.id, "up")}
                          onSave={(input) => onStepSave(step.id, input)}
                          onToggle={() => onToggleStep(step.id)}
                          step={step}
                          stepDraft={stepDrafts[step.id]}
                        />
                      ))}
                </div>

                <form
                  className="step-create"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    onCreateStep();
                  }}
                >
                  <strong>{isCreatingCase ? "+ Add Draft Step" : "+ Add Step"}</strong>
                  <FormField label="Action">
                    <input
                      value={newStepDraft.action}
                      onChange={(event) => onNewStepDraftChange({ ...newStepDraft, action: event.target.value })}
                    />
                  </FormField>
                  <FormField label="Expected result">
                    <textarea
                      rows={3}
                      value={newStepDraft.expected_result}
                      onChange={(event) => onNewStepDraftChange({ ...newStepDraft, expected_result: event.target.value })}
                    />
                  </FormField>
                  <button className="primary-button" type="submit">{isCreatingCase ? "Attach draft step" : "Add step"}</button>
                </form>
              </div>
            </EditorAccordionSection>

            {!isCreatingCase ? (
              <EditorAccordionSection
                countLabel={`${history.length} record${history.length === 1 ? "" : "s"}`}
                isExpanded={expandedSections.history}
                onToggle={() => onToggleSection("history")}
                summary={historySectionSummary}
                title="Execution history"
              >
                <div className="step-editor step-history">
                  <div className="stack-list">
                    {history.map((result) => (
                      <div className="stack-item" key={result.id}>
                        <div>
                          <strong>{result.test_case_title || selectedTestCase?.title || "Execution record"}</strong>
                          <span>{result.error || result.logs || result.created_at || "Historical execution evidence retained."}</span>
                        </div>
                        <StatusBadge value={result.status} />
                      </div>
                    ))}
                    {!history.length ? <div className="empty-state compact">No execution history yet for this test case.</div> : null}
                  </div>
                </div>
              </EditorAccordionSection>
            ) : null}
          </div>
        </div>
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
  stepDraft,
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
  stepDraft?: StepDraft;
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
    action: stepDraft?.action || step.action || "",
    expected_result: stepDraft?.expected_result || step.expected_result || ""
  });

  useEffect(() => {
    setDraft({
      action: stepDraft?.action || step.action || "",
      expected_result: stepDraft?.expected_result || step.expected_result || ""
    });
  }, [step.action, step.expected_result, step.id, stepDraft?.action, stepDraft?.expected_result]);

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

function SuiteExecutionModal({
  suites,
  selectedProject,
  selectedAppType,
  scopeSuiteCount,
  executionName,
  canCreateExecution,
  isSubmitting,
  onExecutionNameChange,
  onRemoveSuite,
  onClose,
  onSubmit
}: {
  suites: TestSuite[];
  selectedProject: string;
  selectedAppType: string;
  scopeSuiteCount: number;
  executionName: string;
  canCreateExecution: boolean;
  isSubmitting: boolean;
  onExecutionNameChange: (value: string) => void;
  onRemoveSuite: (suiteId: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={() => !isSubmitting && onClose()} role="presentation">
      <div
        aria-labelledby="create-suite-execution-title"
        aria-modal="true"
        className="modal-card execution-create-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <form className="execution-create-form" onSubmit={onSubmit}>
          <div className="execution-create-header">
            <div className="execution-create-title">
              <p className="eyebrow">Suites</p>
              <h3 id="create-suite-execution-title">Create execution</h3>
              <p>Use the suites you selected here as the execution snapshot scope.</p>
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
              <span>{selectedAppType ? `${selectedAppType} app type selected for this snapshot.` : "Choose an app type to load suite scope."}</span>
              <span>{scopeSuiteCount ? `${scopeSuiteCount} suites available in the current scope.` : "No suites available in the current scope yet."}</span>
            </div>

            <FormField label="Suite scope" required>
              <div className="selection-summary-card">
                <div className="selection-summary-header">
                  <div>
                    <strong>{suites.length ? `${suites.length} suites selected` : "No suites selected yet"}</strong>
                    <span>These came from the checkboxes in the Suites panel. Remove any chip here before creating the execution.</span>
                  </div>
                </div>

                {suites.length ? (
                  <div className="selection-chip-row">
                    {suites.map((suite) => (
                      <button key={suite.id} className="selection-chip" disabled={isSubmitting} onClick={() => onRemoveSuite(suite.id)} type="button">
                        {suite.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </FormField>

            {!scopeSuiteCount && selectedAppType ? <div className="empty-state compact">No suites available for this app type. Create a suite first.</div> : null}
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

function SuiteModal({
  mode,
  suite,
  suites,
  appTypeCases,
  selectedCaseIds,
  onClose,
  onSubmit,
  isSaving
}: {
  mode: SuiteModalMode;
  suite: TestSuite | null;
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

  const [name, setName] = useState(() => (mode === "edit" && suite ? suite.name : ""));
  const [parentId, setParentId] = useState(() => (mode === "edit" && suite ? suite.parent_id || "" : ""));
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>(() => initialSelectedIds);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={mode === "edit" ? "Edit suite" : "Create suite"}>
        <div className="panel-head">
          <div>
            <h3>{mode === "edit" ? "Edit Suite" : "Create Suite"}</h3>
            <p>Load all test cases for this app type and bulk assign the checked ones into the suite.</p>
          </div>
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
          <FormField label="Suite name">
            <input autoFocus required value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>
          <FormField label="Parent suite">
            <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">None</option>
              {suites
                .filter((item) => item.id !== suite?.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
            </select>
          </FormField>

          <SuiteCasePicker
            cases={appTypeCases}
            description="Select every case you want in this suite, then fine-tune the saved order before submitting."
            emptyMessage="No test cases available in this app type yet."
            heading="App type test cases"
            onChange={setLocalSelectedIds}
            selectedCaseIds={localSelectedIds}
          />

          <div className="action-row suite-modal-actions">
            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : mode === "edit" ? "Save Suite" : "Create Suite"}
            </button>
            <button className="ghost-button" onClick={onClose} type="button">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
