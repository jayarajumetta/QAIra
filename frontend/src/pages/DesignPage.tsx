import { FormEvent, useEffect, useMemo, useState } from "react";
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
  const [isSuiteModalOpen, setIsSuiteModalOpen] = useState(false);
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
    queryKey: ["design-test-cases"],
    queryFn: () => api.testCases.list()
  });
  const stepsQuery = useQuery({
    queryKey: ["design-test-steps", selectedTestCaseId],
    queryFn: () => api.testSteps.list({ test_case_id: selectedTestCaseId }),
    enabled: Boolean(selectedTestCaseId) && !isCreatingCase
  });

  const createSuiteMutation = useMutation({
    mutationFn: api.testSuites.create
  });
  const createTestCaseMutation = useMutation({
    mutationFn: api.testCases.create
  });
  const updateTestCaseMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ suite_id: string; title: string; description: string; priority: number; status: string; requirement_id: string }> }) =>
      api.testCases.update(id, input)
  });
  const deleteTestCaseMutation = useMutation({
    mutationFn: api.testCases.delete
  });
  const createStepMutation = useMutation({
    mutationFn: api.testSteps.create
  });
  const updateStepMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ test_case_id: string; step_order: number; action: string; expected_result: string }> }) =>
      api.testSteps.update(id, input)
  });
  const deleteStepMutation = useMutation({
    mutationFn: api.testSteps.delete
  });

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
    () => allTestCases.filter((testCase) => suiteIds.has(testCase.suite_id)),
    [allTestCases, suiteIds]
  );

  const filteredCases = useMemo(() => {
    return appTypeCases.filter((testCase) => {
      if (selectedSuiteId && testCase.suite_id !== selectedSuiteId) {
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

  const selectedTestCase = filteredCases.find((testCase) => testCase.id === selectedTestCaseId)
    || appTypeCases.find((testCase) => testCase.id === selectedTestCaseId)
    || null;
  const selectedSuite = suites.find((suite) => suite.id === selectedSuiteId) || null;
  const selectedProject = projects.find((project) => project.id === projectId) || null;
  const selectedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;
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
    }
  }, [selectedSuiteId, suites]);

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
      suite_id: selectedTestCase.suite_id,
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

  const refreshDesignData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["test-suites"] }),
      queryClient.invalidateQueries({ queryKey: ["design-suites"] }),
      queryClient.invalidateQueries({ queryKey: ["test-cases"] }),
      queryClient.invalidateQueries({ queryKey: ["design-test-cases"] }),
      queryClient.invalidateQueries({ queryKey: ["test-steps"] }),
      queryClient.invalidateQueries({ queryKey: ["design-test-steps"] })
    ]);
  };

  const handleProjectChange = (value: string) => {
    setProjectId(value);
    setAppTypeId("");
    setSelectedSuiteId("");
    setSelectedTestCaseId("");
    setSelectedTestCaseIds([]);
    setIsCreatingCase(false);
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
    setMessage("");
  };

  const handleCreateSuite = async (input: { name: string; parent_id?: string; selectedIds: string[] }) => {
    try {
      const { id } = await createSuiteMutation.mutateAsync({
        app_type_id: appTypeId,
        name: input.name,
        parent_id: input.parent_id || undefined
      });

      if (input.selectedIds.length) {
        await Promise.all(
          input.selectedIds.map((testCaseId) =>
            api.testCases.update(testCaseId, { suite_id: id })
          )
        );
      }

      setSelectedSuiteId(id);
      setSelectedTestCaseIds([]);
      setIsSuiteModalOpen(false);
      setMessage(input.selectedIds.length ? "Suite created and cases assigned." : "Suite created.");
      await refreshDesignData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create suite");
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
        const { id } = await createTestCaseMutation.mutateAsync({
          suite_id: suiteId,
          title: caseDraft.title,
          description: caseDraft.description || undefined,
          priority: Number(caseDraft.priority || 3),
          status: caseDraft.status || DEFAULT_CASE_STATUS,
          requirement_id: caseDraft.requirement_id || undefined
        });
        setSelectedTestCaseId(id);
        setIsCreatingCase(false);
        setMessage("Test case created.");
      } else {
        await updateTestCaseMutation.mutateAsync({
          id: selectedTestCase.id,
          input: {
            suite_id: suiteId,
            title: caseDraft.title,
            description: caseDraft.description,
            priority: Number(caseDraft.priority || 3),
            status: caseDraft.status,
            requirement_id: caseDraft.requirement_id || undefined
          }
        });
        setMessage("Test case updated.");
      }

      await refreshDesignData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save test case");
    }
  };

  const handleDeleteTestCase = async () => {
    if (!selectedTestCase) {
      return;
    }

    try {
      await deleteTestCaseMutation.mutateAsync(selectedTestCase.id);
      setSelectedTestCaseId("");
      setIsCreatingCase(false);
      setMessage("Test case deleted.");
      await refreshDesignData();
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
      await createStepMutation.mutateAsync({
        test_case_id: selectedTestCase.id,
        step_order: sortedSteps.length + 1,
        action: newStepDraft.action,
        expected_result: newStepDraft.expected_result
      });
      setNewStepDraft({ action: "", expected_result: "" });
      setMessage("Step added.");
      await refreshDesignData();
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
      setMessage("Step updated.");
      await refreshDesignData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update step");
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    try {
      await deleteStepMutation.mutateAsync(stepId);
      setMessage("Step deleted.");
      await refreshDesignData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete step");
    }
  };

  const handleMoveStep = async (stepId: string, direction: "up" | "down") => {
    const index = sortedSteps.findIndex((step) => step.id === stepId);

    if (index === -1) {
      return;
    }

    const swapIndex = direction === "up" ? index - 1 : index + 1;

    if (swapIndex < 0 || swapIndex >= sortedSteps.length) {
      return;
    }

    const current = sortedSteps[index];
    const target = sortedSteps[swapIndex];

    try {
      await Promise.all([
        api.testSteps.update(current.id, {
          test_case_id: current.test_case_id,
          step_order: target.step_order,
          action: stepDrafts[current.id]?.action ?? current.action ?? "",
          expected_result: stepDrafts[current.id]?.expected_result ?? current.expected_result ?? ""
        }),
        api.testSteps.update(target.id, {
          test_case_id: target.test_case_id,
          step_order: current.step_order,
          action: stepDrafts[target.id]?.action ?? target.action ?? "",
          expected_result: stepDrafts[target.id]?.expected_result ?? target.expected_result ?? ""
        })
      ]);
      setMessage("Step order updated.");
      await refreshDesignData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to reorder steps");
    }
  };

  const isDesignLoading = projectsQuery.isLoading
    || appTypesQuery.isLoading
    || suitesQuery.isLoading
    || testCasesQuery.isLoading;

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Test Design"
        title="Design coverage in a focused 3-panel workspace"
        description="Choose project and app type once, browse suites on the left, scan test cases in the middle, and edit the selected case with live steps on the right."
      />

      {message ? <p className="inline-message">{message}</p> : null}

      <div className="design-context-bar">
        <ProjectSelector
          projects={projects}
          value={projectId}
          onChange={handleProjectChange}
        />
        <AppTypeSelector
          appTypes={appTypes}
          value={appTypeId}
          onChange={handleAppTypeChange}
          disabled={!projectId}
        />
      </div>

      <div className="design-layout">
        <SuiteSidebar
          suites={suites}
          activeSuiteId={selectedSuiteId}
          onSelectSuite={(suiteId) => {
            setSelectedSuiteId(suiteId);
            setSelectedTestCaseId("");
            setIsCreatingCase(false);
          }}
          onCreateSuite={() => setIsSuiteModalOpen(true)}
          isLoading={suitesQuery.isLoading && Boolean(appTypeId)}
          selectedAppType={selectedAppType}
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
              current.includes(testCaseId)
                ? current.filter((id) => id !== testCaseId)
                : [...current, testCaseId]
            );
          }}
          onToggleSelectAll={() => {
            const visibleIds = filteredCases.map((item) => item.id);
            const allVisibleSelected = visibleIds.every((id) => selectedTestCaseIds.includes(id));
            setSelectedTestCaseIds(allVisibleSelected ? [] : visibleIds);
          }}
        />

        <TestCaseEditor
          project={selectedProject}
          appType={selectedAppType}
          suites={suites}
          requirements={requirements}
          selectedTestCase={selectedTestCase}
          steps={sortedSteps}
          stepDrafts={stepDrafts}
          caseDraft={caseDraft}
          newStepDraft={newStepDraft}
          isCreatingCase={isCreatingCase}
          isLoading={stepsQuery.isLoading}
          onCaseDraftChange={setCaseDraft}
          onSaveTestCase={handleSaveTestCase}
          onDeleteTestCase={handleDeleteTestCase}
          onStepDraftChange={(stepId, draft) => {
            setStepDrafts((current) => ({ ...current, [stepId]: draft }));
          }}
          onNewStepDraftChange={setNewStepDraft}
          onCreateStep={handleCreateStep}
          onUpdateStep={handleUpdateStep}
          onDeleteStep={handleDeleteStep}
          onMoveStep={handleMoveStep}
        />
      </div>

      {isSuiteModalOpen ? (
        <SuiteModal
          suites={suites}
          visibleCases={filteredCases}
          selectedCaseIds={selectedTestCaseIds}
          onClose={() => setIsSuiteModalOpen(false)}
          onToggleCase={(testCaseId) => {
            setSelectedTestCaseIds((current) =>
              current.includes(testCaseId)
                ? current.filter((id) => id !== testCaseId)
                : [...current, testCaseId]
            );
          }}
          onSubmit={handleCreateSuite}
          isSaving={createSuiteMutation.isPending}
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
  onSelectSuite,
  onCreateSuite,
  isLoading,
  selectedAppType
}: {
  suites: TestSuite[];
  activeSuiteId: string;
  onSelectSuite: (suiteId: string) => void;
  onCreateSuite: () => void;
  isLoading: boolean;
  selectedAppType: AppType | null;
}) {
  return (
    <Panel
      title="Suites"
      subtitle={selectedAppType ? `${selectedAppType.name} · ${selectedAppType.type}` : "Select a project and app type first."}
    >
      <div className="design-sidebar-actions">
        <button className="primary-button" onClick={onCreateSuite} type="button">
          Create Suite
        </button>
        <button
          className={!activeSuiteId ? "ghost-button design-filter-chip is-active" : "ghost-button design-filter-chip"}
          onClick={() => onSelectSuite("")}
          type="button"
        >
          All Cases
        </button>
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
            <div>
              <strong>{suite.name}</strong>
              <span>{suite.parent_id ? "Nested suite" : "Root suite"}</span>
            </div>
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
  onToggleSelectAll
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
}) {
  const allVisibleSelected = Boolean(cases.length) && cases.every((testCase) => selectedCaseIds.includes(testCase.id));

  return (
    <Panel
      title="Test Cases"
      subtitle={selectedSuite ? `Filtered to ${selectedSuite.name}` : "Showing all cases for the current app type."}
    >
      <div className="design-list-toolbar">
        <input
          placeholder="Search cases"
          value={searchTerm}
          onChange={(event) => onSearch(event.target.value)}
        />
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
        <button className="primary-button" onClick={onCreateCase} type="button">
          New Test Case
        </button>
      </div>

      {isLoading ? <div className="empty-state compact">Loading test cases…</div> : null}
      {!isLoading && !cases.length ? <div className="empty-state compact">No test cases match this scope yet.</div> : null}

      <div className="test-case-list">
        {cases.map((testCase) => (
          <button
            key={testCase.id}
            className={activeCaseId === testCase.id ? "record-card is-active" : "record-card"}
            onClick={() => onSelectCase(testCase.id)}
            type="button"
          >
            <label
              className="selection-checkbox"
              onClick={(event) => event.stopPropagation()}
            >
              <input
                checked={selectedCaseIds.includes(testCase.id)}
                onChange={() => onToggleSelection(testCase.id)}
                type="checkbox"
              />
            </label>
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
  requirements,
  selectedTestCase,
  steps,
  stepDrafts,
  caseDraft,
  newStepDraft,
  isCreatingCase,
  isLoading,
  onCaseDraftChange,
  onSaveTestCase,
  onDeleteTestCase,
  onStepDraftChange,
  onNewStepDraftChange,
  onCreateStep,
  onUpdateStep,
  onDeleteStep,
  onMoveStep
}: {
  project: Project | null;
  appType: AppType | null;
  suites: TestSuite[];
  requirements: Requirement[];
  selectedTestCase: TestCase | null;
  steps: TestStep[];
  stepDrafts: Record<string, StepDraft>;
  caseDraft: CaseDraft;
  newStepDraft: { action: string; expected_result: string };
  isCreatingCase: boolean;
  isLoading: boolean;
  onCaseDraftChange: (value: CaseDraft) => void;
  onSaveTestCase: () => void;
  onDeleteTestCase: () => void;
  onStepDraftChange: (stepId: string, draft: StepDraft) => void;
  onNewStepDraftChange: (value: { action: string; expected_result: string }) => void;
  onCreateStep: () => void;
  onUpdateStep: (stepId: string) => void;
  onDeleteStep: (stepId: string) => void;
  onMoveStep: (stepId: string, direction: "up" | "down") => void;
}) {
  const subtitle = isCreatingCase
    ? "Create a new case in the selected suite."
    : selectedTestCase
      ? `Editing ${selectedTestCase.title}`
      : "Choose a test case to start editing.";

  return (
    <Panel title="Test Case Editor" subtitle={subtitle}>
      <div className="detail-summary">
        <strong>{selectedTestCase?.title || (isCreatingCase ? "New test case" : "No test case selected")}</strong>
        <span>
          {project?.name || "No project"} · {appType?.name || "No app type"}
        </span>
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
            <input
              required
              value={caseDraft.title}
              onChange={(event) => onCaseDraftChange({ ...caseDraft, title: event.target.value })}
            />
          </FormField>
          <FormField label="Suite">
            <select
              value={caseDraft.suite_id}
              onChange={(event) => onCaseDraftChange({ ...caseDraft, suite_id: event.target.value })}
            >
              {suites.map((suite) => (
                <option key={suite.id} value={suite.id}>{suite.name}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Priority">
            <input
              min="1"
              type="number"
              value={caseDraft.priority}
              onChange={(event) => onCaseDraftChange({ ...caseDraft, priority: event.target.value })}
            />
          </FormField>
          <FormField label="Status">
            <select
              value={caseDraft.status}
              onChange={(event) => onCaseDraftChange({ ...caseDraft, status: event.target.value })}
            >
              <option value="active">active</option>
              <option value="draft">draft</option>
              <option value="ready">ready</option>
            </select>
          </FormField>
          <FormField label="Requirement">
            <select
              value={caseDraft.requirement_id}
              onChange={(event) => onCaseDraftChange({ ...caseDraft, requirement_id: event.target.value })}
            >
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

        <div className="action-row">
          <button className="primary-button" type="submit">
            {isCreatingCase ? "Create Test Case" : "Save Test Case"}
          </button>
          {!isCreatingCase && selectedTestCase ? (
            <button className="ghost-button danger" onClick={() => void onDeleteTestCase()} type="button">
              Delete Test Case
            </button>
          ) : null}
        </div>
      </form>

      {!isCreatingCase && selectedTestCase ? (
        <StepEditor
          steps={steps}
          stepDrafts={stepDrafts}
          newStepDraft={newStepDraft}
          isLoading={isLoading}
          onStepDraftChange={onStepDraftChange}
          onNewStepDraftChange={onNewStepDraftChange}
          onCreateStep={onCreateStep}
          onUpdateStep={onUpdateStep}
          onDeleteStep={onDeleteStep}
          onMoveStep={onMoveStep}
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
  isLoading,
  onStepDraftChange,
  onNewStepDraftChange,
  onCreateStep,
  onUpdateStep,
  onDeleteStep,
  onMoveStep
}: {
  steps: TestStep[];
  stepDrafts: Record<string, StepDraft>;
  newStepDraft: { action: string; expected_result: string };
  isLoading: boolean;
  onStepDraftChange: (stepId: string, draft: StepDraft) => void;
  onNewStepDraftChange: (value: { action: string; expected_result: string }) => void;
  onCreateStep: () => void;
  onUpdateStep: (stepId: string) => void;
  onDeleteStep: (stepId: string) => void;
  onMoveStep: (stepId: string, direction: "up" | "down") => void;
}) {
  return (
    <div className="step-editor">
      <div className="panel-head">
        <div>
          <h3>Step Editor</h3>
          <p>Load steps dynamically for the selected case, then edit or reorder them inline.</p>
        </div>
      </div>

      {isLoading ? <div className="empty-state compact">Loading steps…</div> : null}
      {!isLoading && !steps.length ? <div className="empty-state compact">No steps yet for this test case.</div> : null}

      <div className="step-list">
        {steps.map((step, index) => {
          const draft = stepDrafts[step.id];

          if (!draft) {
            return null;
          }

          return (
            <article className="step-card" key={step.id}>
              <div className="step-card-top">
                <strong>Step {draft.step_order}</strong>
                <div className="action-row">
                  <button className="ghost-button" disabled={index === 0} onClick={() => onMoveStep(step.id, "up")} type="button">
                    Up
                  </button>
                  <button className="ghost-button" disabled={index === steps.length - 1} onClick={() => onMoveStep(step.id, "down")} type="button">
                    Down
                  </button>
                </div>
              </div>

              <FormField label="Action">
                <textarea
                  rows={2}
                  value={draft.action}
                  onChange={(event) => onStepDraftChange(step.id, { ...draft, action: event.target.value })}
                />
              </FormField>

              <FormField label="Expected result">
                <textarea
                  rows={2}
                  value={draft.expected_result}
                  onChange={(event) => onStepDraftChange(step.id, { ...draft, expected_result: event.target.value })}
                />
              </FormField>

              <div className="action-row">
                <button className="primary-button" onClick={() => onUpdateStep(step.id)} type="button">
                  Save Step
                </button>
                <button className="ghost-button danger" onClick={() => onDeleteStep(step.id)} type="button">
                  Delete Step
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="step-create">
        <FormField label="New step action">
          <textarea
            rows={2}
            value={newStepDraft.action}
            onChange={(event) => onNewStepDraftChange({ ...newStepDraft, action: event.target.value })}
          />
        </FormField>
        <FormField label="New step expected result">
          <textarea
            rows={2}
            value={newStepDraft.expected_result}
            onChange={(event) => onNewStepDraftChange({ ...newStepDraft, expected_result: event.target.value })}
          />
        </FormField>
        <button className="primary-button" onClick={() => void onCreateStep()} type="button">
          Add Step
        </button>
      </div>
    </div>
  );
}

function SuiteModal({
  suites,
  visibleCases,
  selectedCaseIds,
  onClose,
  onToggleCase,
  onSubmit,
  isSaving
}: {
  suites: TestSuite[];
  visibleCases: TestCase[];
  selectedCaseIds: string[];
  onClose: () => void;
  onToggleCase: (testCaseId: string) => void;
  onSubmit: (input: { name: string; parent_id?: string; selectedIds: string[] }) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Create suite">
        <div className="panel-head">
          <div>
            <h3>Create Suite</h3>
            <p>Create a suite and optionally move the selected test cases into it.</p>
          </div>
        </div>

        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({
              name,
              parent_id: parentId || undefined,
              selectedIds: selectedCaseIds
            });
          }}
        >
          <FormField label="Suite name">
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>
          <FormField label="Parent suite">
            <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">None</option>
              {suites.map((suite) => (
                <option key={suite.id} value={suite.id}>{suite.name}</option>
              ))}
            </select>
          </FormField>

          <div className="modal-case-picker">
            <strong>Assign test cases</strong>
            {!visibleCases.length ? <div className="empty-state compact">No visible cases to assign right now.</div> : null}
            {visibleCases.map((testCase) => (
              <label className="modal-case-option" key={testCase.id}>
                <input
                  checked={selectedCaseIds.includes(testCase.id)}
                  onChange={() => onToggleCase(testCase.id)}
                  type="checkbox"
                />
                <span>{testCase.title}</span>
              </label>
            ))}
          </div>

          <div className="action-row">
            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? "Creating…" : "Create Suite"}
            </button>
            <button className="ghost-button" onClick={onClose} type="button">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
