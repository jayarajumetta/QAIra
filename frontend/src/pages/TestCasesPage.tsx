import { ChangeEvent, FormEvent, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AiDesignStudioModal } from "../components/AiDesignStudioModal";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import { ToastMessage } from "../components/ToastMessage";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { parseTestCaseCsv, type ImportedTestCaseRow } from "../lib/testCaseImport";
import { api } from "../lib/api";
import { appendUniqueImages, parseExternalLinks, readImageFiles, toggleRequirementOnPreviewCase } from "../lib/aiDesignStudio";
import type { AiDesignImageInput, AiDesignedTestCaseCandidate, ExecutionResult, Requirement, TestCase, TestStep } from "../types";

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

type EditorSection = "case" | "steps";

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

export function TestCasesPage() {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useState("");
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [isCreating, setIsCreating] = useState(false);
  const [activeEditorSection, setActiveEditorSection] = useState<EditorSection>("case");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [caseDraft, setCaseDraft] = useState<TestCaseDraft>(EMPTY_CASE_DRAFT);
  const [newStepDraft, setNewStepDraft] = useState<StepDraft>(EMPTY_STEP_DRAFT);
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
  const testCasesQuery = useQuery({
    queryKey: ["global-test-cases", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
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
  const testCases = testCasesQuery.data || [];
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

  const beginCreateCase = () => {
    setIsCreating(true);
    setActiveEditorSection("case");
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
    setActiveEditorSection("case");
    setIsCreating(false);
    setIsImportModalOpen(false);
    setCaseDraft(EMPTY_CASE_DRAFT);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setDraftSteps([]);
    setExpandedStepIds([]);
    setImportRows([]);
    setImportWarnings([]);
    setImportFileName("");
    setImportRequirementId("");
    setIsAiStudioOpen(false);
    setAiRequirementIds([]);
    setAiPreviewCases([]);
    setAiPreviewMessage("");
  }, [appTypeId]);

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
    setActiveEditorSection("case");
  }, [isCreating, selectedTestCaseId]);

  useEffect(() => {
    setExpandedStepIds((current) => {
      const validIds = current.filter((id) => displaySteps.some((step) => step.id === id));

      if (!isCreating && displaySteps.length && validIds.length === 0) {
        return displaySteps.map((step) => step.id);
      }

      return validIds;
    });
  }, [displaySteps, isCreating]);

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
      queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] }),
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["design-test-cases", appTypeId] }),
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
      setSelectedTestCaseId("");
      setCaseDraft(EMPTY_CASE_DRAFT);
      setIsCreating(false);
      showSuccess("Test case deleted. Execution snapshots remain available.");
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to delete test case");
    }
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
      setExpandedStepIds((current) => [...new Set([...current, response.id])]);
      showSuccess("Step added.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      showError(error, "Unable to add step");
    }
  };

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
        actions={
          <>
            <button className="ghost-button" disabled={!appTypeId} onClick={() => setIsImportModalOpen(true)} type="button">
              Bulk Import
            </button>
            <button className="ghost-button" disabled={!requirements.length || !appTypeId} onClick={openAiStudio} type="button">
              AI Design Studio
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
        onAppTypeChange={setAppTypeId}
        onProjectChange={setProjectId}
        projectId={projectId}
        projects={projects}
      />

      <div className="metric-strip">
        <div className="mini-card">
          <strong>{coverageMetrics.total}</strong>
          <span>Library cases</span>
        </div>
        <div className="mini-card">
          <strong>{coverageMetrics.covered}</strong>
          <span>Linked to requirements</span>
        </div>
        <div className="mini-card">
          <strong>{coverageMetrics.withSuites}</strong>
          <span>Assigned to one or more suites</span>
        </div>
        <div className="mini-card">
          <strong>{coverageMetrics.withHistory}</strong>
          <span>Have execution history</span>
        </div>
      </div>

      <div className="test-case-workspace">
        <div className="test-case-sidebar">
          <Panel title="Test case library" subtitle={appTypeId ? "Search the library, scan quick quality signals, and jump into a case without the list taking over the page." : "Choose an app type to begin."}>
            <div className="design-list-toolbar">
              <input
                placeholder="Search title, description, or requirement"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              <button className="ghost-button" disabled={!appTypeId} onClick={beginCreateCase} type="button">
                New case
              </button>
            </div>

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
                  const history = (historyByCaseId[testCase.id] || []).slice(0, 10);
                  const latest = history[0];
                  const requirement = requirements.find((item) => (testCase.requirement_ids || [testCase.requirement_id]).includes(item.id));
                  const stepCount = stepCountByCaseId[testCase.id] || 0;

                  return (
                    <button
                      className={selectedTestCaseId === testCase.id && !isCreating ? "record-card tile-card test-case-card is-active" : "record-card tile-card test-case-card"}
                      key={testCase.id}
                      onClick={() => {
                        setSelectedTestCaseId(testCase.id);
                        setActiveEditorSection("case");
                        setIsCreating(false);
                        setDraftSteps([]);
                      }}
                      type="button"
                    >
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
                      <StatusBadge value={latest?.status || testCase.status || "active"} />
                    </button>
                  );
                })}
                {!filteredCases.length ? <div className="empty-state compact">No test cases found for this app type.</div> : null}
              </div>
            ) : null}
          </Panel>
        </div>

        <div className="test-case-editor-column">
          <Panel title="Test case workspace" subtitle={selectedTestCaseId || isCreating ? "Switch between case details and step editing without losing the selected context." : "Select a test case or create a new one."}>
            {selectedTestCaseId || isCreating ? (
              <div className="detail-stack">
                <div className="metric-strip">
                  <div className="mini-card">
                    <strong>{selectedTestCase?.suite_ids?.length || 0}</strong>
                    <span>Linked suites</span>
                  </div>
                  <div className="mini-card">
                    <strong>{selectedHistory.length}</strong>
                    <span>Execution records</span>
                  </div>
                  <div className="mini-card">
                    <strong>{displaySteps.length}</strong>
                    <span>{isCreating ? "Draft steps" : "Defined steps"}</span>
                  </div>
                  <div className="mini-card">
                    <strong>{selectedRequirement ? "Linked" : "Open"}</strong>
                    <span>{selectedRequirement?.title || "Requirement not linked yet"}</span>
                  </div>
                </div>

                <div className="editor-accordion">
                  <EditorAccordionSection
                    countLabel={isCreating ? "Draft" : caseDraft.status || "active"}
                    isExpanded={activeEditorSection === "case"}
                    onExpand={() => setActiveEditorSection("case")}
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

                      <div className="detail-summary">
                        <strong>{isCreating ? "Create with steps attached" : "Live case definition"}</strong>
                        <span>{isCreating ? `This test case will be saved with ${displaySteps.length} draft step${displaySteps.length === 1 ? "" : "s"} attached.` : "Edits here update the reusable test case while execution history remains preserved."}</span>
                      </div>

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
                    isExpanded={activeEditorSection === "steps"}
                    onExpand={() => setActiveEditorSection("steps")}
                    summary={stepSectionSummary}
                    title={isCreating ? "Draft steps" : "Test steps"}
                  >
                    <div className="step-editor step-editor--embedded">
                      <div className="panel-head">
                        <div>
                          <h3>{isCreating ? "Draft steps" : "Test steps"}</h3>
                          <p>{isCreating ? "Attach the execution flow now so the new test case is created fully defined." : "Collapse or expand individual steps while editing. Execution history stays even if this live definition changes later."}</p>
                        </div>
                      </div>

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

                      <form className="step-create" onSubmit={(event) => void handleCreateStep(event)}>
                        <strong>{isCreating ? "+ Add Draft Step" : "+ Add Step"}</strong>
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
                        <button className="primary-button" type="submit">{isCreating ? "Attach draft step" : "Add step"}</button>
                      </form>
                    </div>
                  </EditorAccordionSection>
                </div>

                {!isCreating ? (
                  <div className="step-editor step-history">
                    <div className="panel-head">
                      <div>
                        <h3>Execution history</h3>
                        <p>Recent recorded outcomes for this reusable test case.</p>
                      </div>
                    </div>

                    <div className="stack-list">
                      {selectedHistory.map((result) => (
                        <div className="stack-item" key={result.id}>
                          <div>
                            <strong>{result.test_case_title || selectedTestCase?.title || "Execution record"}</strong>
                            <span>{result.error || result.logs || result.created_at || "Historical execution evidence retained."}</span>
                          </div>
                          <StatusBadge value={result.status} />
                        </div>
                      ))}
                      {!selectedHistory.length ? <div className="empty-state compact">No execution history yet for this test case.</div> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-state compact">Select a test case from the library, or start a new one for this app type.</div>
            )}
          </Panel>
        </div>
      </div>

      {isImportModalOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => setIsImportModalOpen(false)}
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
              <button aria-label="Close bulk import dialog" className="ghost-button" onClick={() => setIsImportModalOpen(false)} type="button">
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
                disabled={!importRows.length}
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

function EditorAccordionSection({
  title,
  summary,
  countLabel,
  isExpanded,
  onExpand,
  children
}: {
  title: string;
  summary: string;
  countLabel: string;
  isExpanded: boolean;
  onExpand: () => void;
  children: ReactNode;
}) {
  return (
    <section className={isExpanded ? "editor-accordion-section is-expanded" : "editor-accordion-section"}>
      <button
        aria-expanded={isExpanded}
        className="editor-accordion-toggle"
        onClick={onExpand}
        type="button"
      >
        <div className="editor-accordion-toggle-main">
          <strong>{title}</strong>
          <span>{summary}</span>
        </div>
        <div className="editor-accordion-toggle-meta">
          <span className="editor-accordion-toggle-count">{countLabel}</span>
          <span className="editor-accordion-toggle-state">{isExpanded ? "Expanded" : "Expand"}</span>
        </div>
      </button>
      {isExpanded ? <div className="editor-accordion-body">{children}</div> : null}
    </section>
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
