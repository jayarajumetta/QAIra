import { DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import type { AppType, Project, Requirement, TestCase, TestStep, TestSuite } from "../types";

type CaseDraft = {
  suite_id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  requirement_id: string;
};

type StepDraft = {
  step_order: number;
  action: string;
  expected_result: string;
};

type SuiteModalMode = "create" | "edit";

const DEFAULT_CASE_STATUS = "active";

export function DesignPage() {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [appTypeId, setAppTypeId] = useState("");
  const [selectedSuiteId, setSelectedSuiteId] = useState("");
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isCreatingCase, setIsCreatingCase] = useState(false);
  const [suiteModalMode, setSuiteModalMode] = useState<SuiteModalMode>("create");
  const [isSuiteModalOpen, setIsSuiteModalOpen] = useState(false);
  const [expandedStepId, setExpandedStepId] = useState("");
  const [isAddingStep, setIsAddingStep] = useState(false);
  const [message, setMessage] = useState("");

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
  const deleteSuiteMutation = useMutation({ mutationFn: api.testSuites.delete });
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

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const requirements = requirementsQuery.data || [];
  const suites = suitesQuery.data || [];
  const allTestCases = testCasesQuery.data || [];
  const steps = stepsQuery.data || [];

  const [caseDraft, setCaseDraft] = useState<CaseDraft>({
    suite_id: "",
    title: "",
    description: "",
    priority: "3",
    status: DEFAULT_CASE_STATUS,
    requirement_id: ""
  });
  const [newStepDraft, setNewStepDraft] = useState({ action: "", expected_result: "" });
  const [stepDrafts, setStepDrafts] = useState<Record<string, StepDraft>>({});

  useEffect(() => {
    if (!projectId && projects[0]) {
      setProjectId(projects[0].id);
    }
  }, [projectId, projects]);

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

  const filteredCases = useMemo(() => {
    return appTypeCases.filter((testCase) => {
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
  }, [appTypeCases, searchTerm, selectedSuiteId, statusFilter]);

  const selectedProject = projects.find((project) => project.id === projectId) || null;
  const selectedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;
  const selectedSuite = suites.find((suite) => suite.id === selectedSuiteId) || null;
  const selectedTestCase = appTypeCases.find((testCase) => testCase.id === selectedTestCaseId) || null;
  const sortedSteps = useMemo(
    () => [...steps].sort((left, right) => left.step_order - right.step_order),
    [steps]
  );

  useEffect(() => {
    setSelectedTestCaseIds((current) => current.filter((id) => filteredCases.some((testCase) => testCase.id === id)));
  }, [filteredCases]);

  useEffect(() => {
    if (selectedSuiteId && !suites.some((suite) => suite.id === selectedSuiteId)) {
      setSelectedSuiteId("");
      setSelectedTestCaseId("");
      setIsCreatingCase(false);
    }
  }, [selectedSuiteId, suites]);

  useEffect(() => {
    setSelectedTestCaseId("");
    setIsCreatingCase(false);
    setExpandedStepId("");
    setIsAddingStep(false);
  }, [selectedSuiteId]);

  useEffect(() => {
    setExpandedStepId("");
    setIsAddingStep(false);
    setNewStepDraft({ action: "", expected_result: "" });
  }, [selectedTestCaseId]);

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
        suite_id: selectedSuiteId || suites[0]?.id || "",
        title: "",
        description: "",
        priority: "3",
        status: DEFAULT_CASE_STATUS,
        requirement_id: ""
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
        step_order: step.step_order,
        action: step.action || "",
        expected_result: step.expected_result || ""
      };
    });
    setStepDrafts(drafts);
  }, [sortedSteps]);

  const updateCasesCache = (updater: (current: TestCase[]) => TestCase[]) => {
    queryClient.setQueryData<TestCase[]>(["design-test-cases"], (current = []) => updater(current));
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
      queryClient.invalidateQueries({ queryKey: ["design-test-cases"] }),
      queryClient.invalidateQueries({ queryKey: ["test-cases"] }),
      queryClient.invalidateQueries({ queryKey: ["global-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["global-test-case-results", appTypeId] })
    ]);
  };

  const handleProjectChange = (value: string) => {
    setProjectId(value);
    setAppTypeId("");
    setSelectedSuiteId("");
    setSelectedTestCaseId("");
    setSelectedTestCaseIds([]);
    setIsCreatingCase(false);
    setExpandedStepId("");
    setMessage("");
  };

  const handleAppTypeChange = (value: string) => {
    setAppTypeId(value);
    setSelectedSuiteId("");
    setSelectedTestCaseId("");
    setSelectedTestCaseIds([]);
    setIsCreatingCase(false);
    setSearchTerm("");
    setStatusFilter("all");
    setExpandedStepId("");
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

      if (input.selectedIds.length) {
        await assignSuiteCasesMutation.mutateAsync({
          id: suiteId,
          testCaseIds: input.selectedIds
        });
      }

      setSelectedSuiteId(suiteId);
      setSelectedTestCaseIds([]);
      setIsSuiteModalOpen(false);
      setMessage(suiteModalMode === "create" ? "Suite created." : "Suite updated.");
      await refreshSuites();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save suite");
    }
  };

  const handleSaveTestCase = async () => {
    const suiteId = caseDraft.suite_id || selectedSuiteId || suites[0]?.id || "";

    if (!suiteId) {
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
          requirement_id: caseDraft.requirement_id || undefined
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
        setMessage("Test case created.");
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

        setMessage("Test case updated.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save test case");
    }
  };

  const handleDeleteSuite = async () => {
    if (!selectedSuite || !window.confirm(`Delete suite "${selectedSuite.name}"? Linked test cases will be kept, but this suite mapping will be removed.`)) {
      return;
    }

    try {
      await deleteSuiteMutation.mutateAsync(selectedSuite.id);
      setSelectedSuiteId("");
      setSelectedTestCaseId("");
      setSelectedTestCaseIds([]);
      setMessage("Suite deleted.");
      await refreshSuites();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete suite");
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
      setSelectedTestCaseIds((current) => current.filter((id) => id !== selectedTestCase.id));
      setIsCreatingCase(false);
      setMessage("Test case deleted.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["requirements", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["global-test-cases", appTypeId] }),
        queryClient.invalidateQueries({ queryKey: ["global-test-case-results", appTypeId] })
      ]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete test case");
    }
  };

  const handleCreateStep = async () => {
    if (!selectedTestCase) {
      setMessage("Select a test case before adding steps.");
      return;
    }

    try {
      const response = await createStepMutation.mutateAsync({
        test_case_id: selectedTestCase.id,
        step_order: sortedSteps.length + 1,
        action: newStepDraft.action,
        expected_result: newStepDraft.expected_result
      });

      const optimisticStep: TestStep = {
        id: response.id,
        test_case_id: selectedTestCase.id,
        step_order: sortedSteps.length + 1,
        action: newStepDraft.action || null,
        expected_result: newStepDraft.expected_result || null
      };

      updateStepsCache(selectedTestCase.id, (current) => [...current, optimisticStep]);
      setNewStepDraft({ action: "", expected_result: "" });
      setIsAddingStep(false);
      setExpandedStepId(response.id);
      setMessage("Step added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add step");
    }
  };

  const handleUpdateStep = async (stepId: string) => {
    const draft = stepDrafts[stepId];
    const step = sortedSteps.find((item) => item.id === stepId);

    if (!draft || !step) {
      return;
    }

    try {
      await updateStepMutation.mutateAsync({
        id: stepId,
        input: {
          test_case_id: step.test_case_id,
          step_order: draft.step_order,
          action: draft.action,
          expected_result: draft.expected_result
        }
      });

      updateStepsCache(step.test_case_id, (current) =>
        current.map((item) =>
          item.id === stepId
            ? {
                ...item,
                step_order: draft.step_order,
                action: draft.action || null,
                expected_result: draft.expected_result || null
              }
            : item
        )
      );

      setMessage("Step updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update step");
    }
  };

  const handleDeleteStep = async (stepId: string) => {
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
      setExpandedStepId((current) => (current === stepId ? "" : current));
      setMessage("Step deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete step");
    }
  };

  const handleReorderSteps = async (fromStepId: string, toStepId: string) => {
    if (!selectedTestCase || fromStepId === toStepId) {
      return;
    }

    const reordered = [...sortedSteps];
    const fromIndex = reordered.findIndex((step) => step.id === fromStepId);
    const toIndex = reordered.findIndex((step) => step.id === toStepId);

    if (fromIndex === -1 || toIndex === -1) {
      return;
    }

    const [movedStep] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, movedStep);

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
      setExpandedStepId(fromStepId);
      setMessage("Step order updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to reorder steps");
    }
  };

  const handleReorderCases = async (fromCaseId: string, toCaseId: string) => {
    if (!selectedSuiteId || fromCaseId === toCaseId) {
      return;
    }

    const reordered = [...filteredCases];
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
      await queryClient.invalidateQueries({ queryKey: ["design-test-cases"] });
      setMessage("Test case order updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to reorder test cases");
    }
  };

  const isDesignLoading = projectsQuery.isLoading || appTypesQuery.isLoading || suitesQuery.isLoading || testCasesQuery.isLoading;

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Test Design"
        title="Test Suites"
        description="Choose project and app type once, browse suites on the left, scan test cases in the middle, and edit the selected case with live steps on the right."
        actions={<button className="primary-button" onClick={() => {
          setSuiteModalMode("create");
          setIsSuiteModalOpen(true);
        }} type="button">+ Create Suite</button>}
      />

      {message ? <p className="inline-message">{message}</p> : null}

      <div className="design-context-bar">
        <ProjectSelector projects={projects} value={projectId} onChange={handleProjectChange} />
        <AppTypeSelector appTypes={appTypes} value={appTypeId} onChange={handleAppTypeChange} disabled={!projectId} />
      </div>

      <div className="design-layout">
        <SuiteSidebar
          suites={suites}
          activeSuiteId={selectedSuiteId}
          counts={suiteCounts}
          onSelectSuite={setSelectedSuiteId}
          onViewAllCases={() => setSelectedSuiteId("")}
          onCreateSuite={() => {
            setSuiteModalMode("create");
            setIsSuiteModalOpen(true);
          }}
          onEditSuite={() => {
            setSuiteModalMode("edit");
            setIsSuiteModalOpen(true);
          }}
          onDeleteSuite={() => void handleDeleteSuite()}
          isLoading={suitesQuery.isLoading && Boolean(appTypeId)}
          selectedAppType={selectedAppType}
          selectedSuite={selectedSuite}
        />

        <TestCaseList
          cases={filteredCases}
          activeCaseId={selectedTestCaseId}
          searchTerm={searchTerm}
          statusFilter={statusFilter}
          selectedCaseIds={selectedTestCaseIds}
          selectedSuite={selectedSuite}
          isLoading={isDesignLoading}
          onSearch={setSearchTerm}
          onStatusFilter={setStatusFilter}
          onSelectCase={(testCaseId) => {
            setSelectedTestCaseId(testCaseId);
            setIsCreatingCase(false);
          }}
          onCreateCase={() => {
            setSelectedTestCaseId("");
            setIsCreatingCase(true);
          }}
          onToggleSelection={(testCaseId) => {
            setSelectedTestCaseIds((current) =>
              current.includes(testCaseId) ? current.filter((id) => id !== testCaseId) : [...current, testCaseId]
            );
          }}
          onToggleSelectAll={() => {
            const visibleIds = filteredCases.map((item) => item.id);
            const allVisibleSelected = visibleIds.every((id) => selectedTestCaseIds.includes(id));
            setSelectedTestCaseIds(allVisibleSelected ? [] : visibleIds);
          }}
          onReorderCases={handleReorderCases}
        />

        <TestCaseEditor
          project={selectedProject}
          appType={selectedAppType}
          suites={suites}
          selectedSuite={selectedSuite}
          requirements={requirements}
          selectedTestCase={selectedTestCase}
          steps={sortedSteps}
          stepDrafts={stepDrafts}
          caseDraft={caseDraft}
          newStepDraft={newStepDraft}
          expandedStepId={expandedStepId}
          isCreatingCase={isCreatingCase}
          isAddingStep={isAddingStep}
          isLoading={stepsQuery.isLoading}
          onCaseDraftChange={setCaseDraft}
          onSaveTestCase={handleSaveTestCase}
          onDeleteTestCase={handleDeleteTestCase}
          onToggleExpandStep={(stepId) => setExpandedStepId((current) => (current === stepId ? "" : stepId))}
          onStepDraftChange={(stepId, draft) => {
            setStepDrafts((current) => ({ ...current, [stepId]: draft }));
          }}
          onNewStepDraftChange={setNewStepDraft}
          onToggleAddStep={() => setIsAddingStep((current) => !current)}
          onCreateStep={handleCreateStep}
          onUpdateStep={handleUpdateStep}
          onDeleteStep={handleDeleteStep}
          onReorderSteps={handleReorderSteps}
        />
      </div>

      {isSuiteModalOpen ? (
        <SuiteModal
          mode={suiteModalMode}
          suite={selectedSuite}
          suites={suites}
          appTypeCases={allTestCases}
          selectedCaseIds={selectedTestCaseIds}
          onClose={() => setIsSuiteModalOpen(false)}
          onSubmit={handleSuiteSave}
          isSaving={createSuiteMutation.isPending || updateSuiteMutation.isPending || assignSuiteCasesMutation.isPending}
        />
      ) : null}
    </div>
  );
}

function ProjectSelector({
  projects,
  value,
  onChange
}: {
  projects: Project[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="context-field">
      <span>Project</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>{project.name}</option>
        ))}
      </select>
    </label>
  );
}

function AppTypeSelector({
  appTypes,
  value,
  onChange,
  disabled
}: {
  appTypes: AppType[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="context-field">
      <span>App Type</span>
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        {appTypes.length ? null : <option value="">No app types</option>}
        {appTypes.map((appType) => (
          <option key={appType.id} value={appType.id}>{appType.name}</option>
        ))}
      </select>
    </label>
  );
}

function SuiteSidebar({
  suites,
  activeSuiteId,
  counts,
  onSelectSuite,
  onViewAllCases,
  onCreateSuite,
  onEditSuite,
  onDeleteSuite,
  isLoading,
  selectedAppType,
  selectedSuite
}: {
  suites: TestSuite[];
  activeSuiteId: string;
  counts: Record<string, number>;
  onSelectSuite: (suiteId: string) => void;
  onViewAllCases: () => void;
  onCreateSuite: () => void;
  onEditSuite: () => void;
  onDeleteSuite: () => void;
  isLoading: boolean;
  selectedAppType: AppType | null;
  selectedSuite: TestSuite | null;
}) {
  return (
    <Panel title="Suites" subtitle={selectedAppType ? `${selectedAppType.name} · ${selectedAppType.type}` : "Select a project and app type first."}>
      <div className="design-sidebar-actions">
        <button className="primary-button" onClick={onCreateSuite} type="button">Create Suite</button>
        <button className="ghost-button" disabled={!selectedSuite} onClick={onEditSuite} type="button">Edit Suite</button>
        <button className="ghost-button" onClick={onViewAllCases} type="button">View All Test Cases</button>
        <button className="ghost-button danger" disabled={!selectedSuite} onClick={onDeleteSuite} type="button">Delete Suite</button>
      </div>
      {isLoading ? <div className="empty-state compact">Loading suites…</div> : null}
      {!isLoading && !suites.length ? <div className="empty-state compact">No suites yet for this app type.</div> : null}

      <div className="suite-sidebar-list">
        {suites.map((suite) => (
          <button
            key={suite.id}
            className={activeSuiteId === suite.id ? "record-card is-active" : "record-card"}
            onClick={() => onSelectSuite(suite.id)}
            type="button"
          >
            <div className="record-card-body">
              <strong>{suite.name}</strong>
              <span>{suite.parent_id ? "Nested suite" : "Root suite"}</span>
            </div>
            <span className="count-pill">{counts[suite.id] || 0}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function TestCaseList({
  cases,
  activeCaseId,
  searchTerm,
  statusFilter,
  selectedCaseIds,
  selectedSuite,
  isLoading,
  onSearch,
  onStatusFilter,
  onSelectCase,
  onCreateCase,
  onToggleSelection,
  onToggleSelectAll,
  onReorderCases
}: {
  cases: TestCase[];
  activeCaseId: string;
  searchTerm: string;
  statusFilter: string;
  selectedCaseIds: string[];
  selectedSuite: TestSuite | null;
  isLoading: boolean;
  onSearch: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onSelectCase: (testCaseId: string) => void;
  onCreateCase: () => void;
  onToggleSelection: (testCaseId: string) => void;
  onToggleSelectAll: () => void;
  onReorderCases: (fromCaseId: string, toCaseId: string) => void;
}) {
  const allVisibleSelected = Boolean(cases.length) && cases.every((testCase) => selectedCaseIds.includes(testCase.id));
  const [draggedCaseId, setDraggedCaseId] = useState("");

  return (
    <Panel title="Test Cases" subtitle={selectedSuite ? `Scoped to ${selectedSuite.name}` : "Showing all cases for the current app type."}>
      <div className="design-list-toolbar">
        <input placeholder="Search cases" value={searchTerm} onChange={(event) => onSearch(event.target.value)} />
        <select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">active</option>
          <option value="draft">draft</option>
          <option value="ready">ready</option>
        </select>
      </div>

      <div className="design-list-toolbar secondary">
        <button className="ghost-button" onClick={onToggleSelectAll} type="button">
          {allVisibleSelected ? "Clear visible" : "Select visible"}
        </button>
        <button className="primary-button" onClick={onCreateCase} type="button">New Test Case</button>
      </div>

      {isLoading ? <div className="empty-state compact">Loading test cases…</div> : null}
      {!isLoading && !cases.length ? <div className="empty-state compact">No test cases match this scope yet.</div> : null}

      <div className="test-case-list">
        {cases.map((testCase) => (
          <button
            key={testCase.id}
            className={activeCaseId === testCase.id ? "record-card is-active" : "record-card"}
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
            <label className="selection-checkbox" onClick={(event) => event.stopPropagation()}>
              <input checked={selectedCaseIds.includes(testCase.id)} onChange={() => onToggleSelection(testCase.id)} type="checkbox" />
            </label>
            {selectedSuite ? <span className="drag-handle" aria-hidden="true">::</span> : null}
            <div className="record-card-body">
              <strong>{testCase.title}</strong>
              <span>{testCase.description || "No description"}</span>
            </div>
            <StatusBadge value={testCase.status || DEFAULT_CASE_STATUS} />
          </button>
        ))}
      </div>
    </Panel>
  );
}

function TestCaseEditor({
  project,
  appType,
  suites,
  selectedSuite,
  requirements,
  selectedTestCase,
  steps,
  stepDrafts,
  caseDraft,
  newStepDraft,
  expandedStepId,
  isCreatingCase,
  isAddingStep,
  isLoading,
  onCaseDraftChange,
  onSaveTestCase,
  onDeleteTestCase,
  onToggleExpandStep,
  onStepDraftChange,
  onNewStepDraftChange,
  onToggleAddStep,
  onCreateStep,
  onUpdateStep,
  onDeleteStep,
  onReorderSteps
}: {
  project: Project | null;
  appType: AppType | null;
  suites: TestSuite[];
  selectedSuite: TestSuite | null;
  requirements: Requirement[];
  selectedTestCase: TestCase | null;
  steps: TestStep[];
  stepDrafts: Record<string, StepDraft>;
  caseDraft: CaseDraft;
  newStepDraft: { action: string; expected_result: string };
  expandedStepId: string;
  isCreatingCase: boolean;
  isAddingStep: boolean;
  isLoading: boolean;
  onCaseDraftChange: (value: CaseDraft) => void;
  onSaveTestCase: () => void;
  onDeleteTestCase: () => void;
  onToggleExpandStep: (stepId: string) => void;
  onStepDraftChange: (stepId: string, draft: StepDraft) => void;
  onNewStepDraftChange: (value: { action: string; expected_result: string }) => void;
  onToggleAddStep: () => void;
  onCreateStep: () => void;
  onUpdateStep: (stepId: string) => void;
  onDeleteStep: (stepId: string) => void;
  onReorderSteps: (fromStepId: string, toStepId: string) => void;
}) {
  const subtitle = isCreatingCase
    ? `Creating inside ${selectedSuite?.name || "the selected suite"}`
    : selectedTestCase
      ? `Editing ${selectedTestCase.title}`
      : "Choose a test case to start editing.";

  return (
    <Panel title="Test Case Editor" subtitle={subtitle}>
      <div className="detail-summary">
        <strong>{selectedTestCase?.title || (isCreatingCase ? "New test case" : "No test case selected")}</strong>
        <span>{project?.name || "No project"} · {appType?.name || "No app type"}</span>
        <span>Suite context: {selectedSuite?.name || "All suites"}</span>
      </div>

      <form
        className="form-grid"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void onSaveTestCase();
        }}
      >
        <div className="record-grid">
          <FormField label="Title">
            <input required value={caseDraft.title} onChange={(event) => onCaseDraftChange({ ...caseDraft, title: event.target.value })} />
          </FormField>
          <FormField label="Suite">
            <select value={caseDraft.suite_id} onChange={(event) => onCaseDraftChange({ ...caseDraft, suite_id: event.target.value })}>
              {suites.map((suite) => (
                <option key={suite.id} value={suite.id}>{suite.name}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Priority">
            <input min="1" type="number" value={caseDraft.priority} onChange={(event) => onCaseDraftChange({ ...caseDraft, priority: event.target.value })} />
          </FormField>
          <FormField label="Status">
            <select value={caseDraft.status} onChange={(event) => onCaseDraftChange({ ...caseDraft, status: event.target.value })}>
              <option value="active">active</option>
              <option value="draft">draft</option>
              <option value="ready">ready</option>
            </select>
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
          <textarea rows={4} value={caseDraft.description} onChange={(event) => onCaseDraftChange({ ...caseDraft, description: event.target.value })} />
        </FormField>

        <div className="action-row">
          <button className="primary-button" type="submit">{isCreatingCase ? "Create Test Case" : "Save Test Case"}</button>
          {!isCreatingCase && selectedTestCase ? (
            <button className="ghost-button danger" onClick={() => void onDeleteTestCase()} type="button">Delete Test Case</button>
          ) : null}
        </div>
      </form>

      {!isCreatingCase && selectedTestCase ? (
        <StepEditor
          steps={steps}
          stepDrafts={stepDrafts}
          newStepDraft={newStepDraft}
          expandedStepId={expandedStepId}
          isLoading={isLoading}
          isAddingStep={isAddingStep}
          onToggleExpandStep={onToggleExpandStep}
          onStepDraftChange={onStepDraftChange}
          onNewStepDraftChange={onNewStepDraftChange}
          onToggleAddStep={onToggleAddStep}
          onCreateStep={onCreateStep}
          onUpdateStep={onUpdateStep}
          onDeleteStep={onDeleteStep}
          onReorderSteps={onReorderSteps}
        />
      ) : (
        <div className="empty-state compact">Save a test case to start authoring steps.</div>
      )}
    </Panel>
  );
}

function StepEditor({
  steps,
  stepDrafts,
  newStepDraft,
  expandedStepId,
  isLoading,
  isAddingStep,
  onToggleExpandStep,
  onStepDraftChange,
  onNewStepDraftChange,
  onToggleAddStep,
  onCreateStep,
  onUpdateStep,
  onDeleteStep,
  onReorderSteps
}: {
  steps: TestStep[];
  stepDrafts: Record<string, StepDraft>;
  newStepDraft: { action: string; expected_result: string };
  expandedStepId: string;
  isLoading: boolean;
  isAddingStep: boolean;
  onToggleExpandStep: (stepId: string) => void;
  onStepDraftChange: (stepId: string, draft: StepDraft) => void;
  onNewStepDraftChange: (value: { action: string; expected_result: string }) => void;
  onToggleAddStep: () => void;
  onCreateStep: () => void;
  onUpdateStep: (stepId: string) => void;
  onDeleteStep: (stepId: string) => void;
  onReorderSteps: (fromStepId: string, toStepId: string) => void;
}) {
  const [draggedStepId, setDraggedStepId] = useState("");

  return (
    <div className="step-editor">
      <div className="panel-head">
        <div>
          <h3>Step Editor</h3>
          <p>Use collapsible cards for focused edits, and drag steps to reorder them.</p>
        </div>
      </div>

      <div className="design-list-toolbar secondary">
        <button className="primary-button" onClick={onToggleAddStep} type="button">
          {isAddingStep ? "Cancel Step" : "+ Add Step"}
        </button>
      </div>

      {isAddingStep ? (
        <div className="step-create">
          <FormField label="New step action">
            <textarea rows={2} value={newStepDraft.action} onChange={(event) => onNewStepDraftChange({ ...newStepDraft, action: event.target.value })} />
          </FormField>
          <FormField label="New step expected result">
            <textarea rows={2} value={newStepDraft.expected_result} onChange={(event) => onNewStepDraftChange({ ...newStepDraft, expected_result: event.target.value })} />
          </FormField>
          <button className="primary-button" onClick={() => void onCreateStep()} type="button">Add Step</button>
        </div>
      ) : null}

      {isLoading ? <div className="empty-state compact">Loading steps…</div> : null}
      {!isLoading && !steps.length ? <div className="empty-state compact">No steps yet for this test case.</div> : null}

      <div className="step-list">
        {steps.map((step) => {
          const draft = stepDrafts[step.id];
          const isExpanded = expandedStepId === step.id;

          if (!draft) {
            return null;
          }

          return (
            <article
              className={isExpanded ? "step-card is-expanded" : "step-card"}
              draggable
              key={step.id}
              onDragStart={() => setDraggedStepId(step.id)}
              onDragOver={(event: DragEvent<HTMLElement>) => event.preventDefault()}
              onDrop={() => {
                if (draggedStepId) {
                  void onReorderSteps(draggedStepId, step.id);
                }
                setDraggedStepId("");
              }}
              onDragEnd={() => setDraggedStepId("")}
            >
              <button className="step-card-toggle" onClick={() => onToggleExpandStep(step.id)} type="button">
                <div>
                  <strong>Step {draft.step_order}</strong>
                  <span>{draft.action || "No action yet"}</span>
                </div>
                <span>{isExpanded ? "Collapse" : "Expand"}</span>
              </button>

              {isExpanded ? (
                <div className="step-card-body">
                  <FormField label="Action">
                    <textarea rows={2} value={draft.action} onChange={(event) => onStepDraftChange(step.id, { ...draft, action: event.target.value })} />
                  </FormField>
                  <FormField label="Expected result">
                    <textarea rows={2} value={draft.expected_result} onChange={(event) => onStepDraftChange(step.id, { ...draft, expected_result: event.target.value })} />
                  </FormField>
                <div className="action-row">
                  <span className="drag-handle" aria-hidden="true">::</span>
                  <button className="primary-button" onClick={() => void onUpdateStep(step.id)} type="button">Save Step</button>
                  <button className="ghost-button danger" onClick={() => void onDeleteStep(step.id)} type="button">Delete Step</button>
                </div>
                </div>
              ) : null}
            </article>
          );
        })}
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
  const initialSelectedIds = useMemo(() => {
    if (mode === "edit" && suite) {
      return appTypeCases.filter((testCase) => (testCase.suite_ids || []).includes(suite.id)).map((testCase) => testCase.id);
    }
    return selectedCaseIds;
  }, [appTypeCases, mode, selectedCaseIds, suite]);

  const [name, setName] = useState(mode === "edit" && suite ? suite.name : "");
  const [parentId, setParentId] = useState(mode === "edit" && suite ? suite.parent_id || "" : "");
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>(initialSelectedIds);

  useEffect(() => {
    setName(mode === "edit" && suite ? suite.name : "");
    setParentId(mode === "edit" && suite ? suite.parent_id || "" : "");
    setLocalSelectedIds(initialSelectedIds);
  }, [initialSelectedIds, mode, suite]);

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
          className="form-grid"
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
            <input required value={name} onChange={(event) => setName(event.target.value)} />
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

          <div className="modal-case-picker">
            <strong>App type test cases</strong>
            <span>Checked cases will be assigned to this suite.</span>
            {!appTypeCases.length ? <div className="empty-state compact">No test cases available in this app type yet.</div> : null}
            {appTypeCases.map((testCase) => (
              <label className="modal-case-option" key={testCase.id}>
                <input
                  checked={localSelectedIds.includes(testCase.id)}
                  onChange={() => {
                    setLocalSelectedIds((current) =>
                      current.includes(testCase.id) ? current.filter((id) => id !== testCase.id) : [...current, testCase.id]
                    );
                  }}
                  type="checkbox"
                />
                <span>{testCase.title}</span>
              </label>
            ))}
          </div>

          <div className="action-row">
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
