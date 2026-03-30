import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { parseTestCaseCsv, type ImportedTestCaseRow } from "../lib/testCaseImport";
import { api } from "../lib/api";
import type { ExecutionResult, Requirement, TestCase, TestStep } from "../types";

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

const toCsvCell = (value: string | number | null | undefined) => {
  const normalized = String(value ?? "");
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, "\"\"")}"` : normalized;
};

export function TestCasesPage() {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [appTypeId, setAppTypeId] = useState("");
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [caseDraft, setCaseDraft] = useState<TestCaseDraft>(EMPTY_CASE_DRAFT);
  const [newStepDraft, setNewStepDraft] = useState<StepDraft>(EMPTY_STEP_DRAFT);
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importRows, setImportRows] = useState<ImportedTestCaseRow[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importRequirementId, setImportRequirementId] = useState("");

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
  const steps = useMemo(
    () => ((stepsQuery.data || []) as TestStep[]).slice().sort((left, right) => left.step_order - right.step_order),
    [stepsQuery.data]
  );

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
      return;
    }

    if (!appTypes.some((item) => item.id === appTypeId)) {
      setAppTypeId(appTypes[0].id);
    }
  }, [appTypeId, appTypes]);

  useEffect(() => {
    setSelectedTestCaseId("");
    setIsCreating(false);
    setCaseDraft(EMPTY_CASE_DRAFT);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setExpandedStepIds([]);
    setImportRows([]);
    setImportWarnings([]);
    setImportFileName("");
    setImportRequirementId("");
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

  const filteredCases = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

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
  }, [requirements, searchTerm, testCases]);

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
  }, [selectedTestCaseId]);

  useEffect(() => {
    setExpandedStepIds((current) => current.filter((id) => steps.some((step) => step.id === id)));
  }, [steps]);

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
          suite_ids: []
        });

        setSelectedTestCaseId(response.id);
        setIsCreating(false);
        showSuccess("Test case created.");
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

    if (!selectedTestCaseId) {
      return;
    }

    try {
      const nextStepOrder = (steps[steps.length - 1]?.step_order || 0) + 1;
      const response = await createStep.mutateAsync({
        test_case_id: selectedTestCaseId,
        step_order: nextStepOrder,
        action: newStepDraft.action || undefined,
        expected_result: newStepDraft.expected_result || undefined
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

  const selectedRequirement = requirements.find((item) => item.id === caseDraft.requirement_id) || null;
  const selectedHistory = selectedTestCase ? historyByCaseId[selectedTestCase.id] || [] : [];

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Test Cases"
        title="Test Case Library"
        description="Manage reusable cases as the core asset of the system, import them in bulk, link them to requirements, and keep execution history visible even when the live design changes."
        actions={
          <div className="page-actions">
            <button className="ghost-button" disabled={!filteredCases.length} onClick={() => void handleExportCsv()} type="button">
              Export CSV
            </button>
            <button
              className="primary-button"
              onClick={() => {
                setIsCreating(true);
                setSelectedTestCaseId("");
                setCaseDraft(EMPTY_CASE_DRAFT);
              }}
              type="button"
            >
              + New Test Case
            </button>
          </div>
        }
      />

      {message ? <p className={messageTone === "error" ? "inline-message error-message" : "inline-message success-message"}>{message}</p> : null}

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

      <div className="workspace-grid">
        <div className="detail-stack">
          <Panel title="Bulk import from CSV" subtitle="Mandatory: title. Optional: action becomes steps and expected result is mapped when present.">
            <div className="detail-stack">
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

              <div className="detail-summary">
                <strong>{importFileName || "No CSV loaded yet"}</strong>
                <span>Rows ready: {importRows.length}</span>
                <span>Steps can be split with new lines or the `|` character inside the Action and Expected Result columns.</span>
              </div>

              {importWarnings.length ? (
                <div className="empty-state compact">
                  {importWarnings.slice(0, 4).map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}

              {importRows.length ? (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Action / Steps</th>
                        <th>Expected Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 5).map((row, index) => (
                        <tr key={`${row.title}-${index}`}>
                          <td>{row.title}</td>
                          <td>{row.action || "No action supplied"}</td>
                          <td>{row.expected_result || "No expected result"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <div className="action-row">
                <button className="primary-button" disabled={!appTypeId || !importRows.length} onClick={() => void handleBulkImport()} type="button">
                  Import {importRows.length || ""} Test Cases
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
          </Panel>

          <Panel title="Test case library" subtitle={appTypeId ? "Search the app-type-wide library and inspect the latest execution trend for each case." : "Choose an app type to begin."}>
            <div className="design-list-toolbar">
              <input
                placeholder="Search title, description, or requirement"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>

            {testCasesQuery.isLoading || executionResultsQuery.isLoading ? (
              <div className="record-list">
                <div className="skeleton-block" />
                <div className="skeleton-block" />
                <div className="skeleton-block" />
              </div>
            ) : null}
            {!testCasesQuery.isLoading && !filteredCases.length ? <div className="empty-state compact">No test cases found for this app type.</div> : null}

            <div className="record-list">
              {filteredCases.map((testCase: TestCase) => {
                const history = (historyByCaseId[testCase.id] || []).slice(0, 10);
                const latest = history[0];
                const requirement = requirements.find((item) => (testCase.requirement_ids || [testCase.requirement_id]).includes(item.id));

                return (
                  <button
                    className={selectedTestCaseId === testCase.id ? "record-card tile-card test-case-card is-active" : "record-card tile-card test-case-card"}
                    key={testCase.id}
                    onClick={() => {
                      setSelectedTestCaseId(testCase.id);
                      setIsCreating(false);
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
            </div>
          </Panel>
        </div>

        <Panel title={isCreating ? "New test case" : selectedTestCase ? "Selected test case" : "Test case editor"} subtitle={selectedTestCaseId || isCreating ? "Edit the core test case once here, then reuse it in suites while keeping past executions intact." : "Select a test case or create a new one."}>
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
                  <strong>{steps.length}</strong>
                  <span>Defined steps</span>
                </div>
                <div className="mini-card">
                  <strong>{selectedRequirement ? "Linked" : "Open"}</strong>
                  <span>{selectedRequirement?.title || "Requirement not linked yet"}</span>
                </div>
              </div>

              <form className="form-grid" onSubmit={(event) => void handleSaveCase(event)}>
                <div className="record-grid">
                  <FormField label="Title">
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
                  <button className="primary-button" type="submit">{isCreating ? "Create test case" : "Save test case"}</button>
                  {!isCreating && selectedTestCase ? (
                    <button className="ghost-button danger" onClick={() => void handleDeleteCase()} type="button">
                      Delete test case
                    </button>
                  ) : null}
                </div>
              </form>

              {!isCreating ? (
                <div className="step-editor">
                  <div className="panel-head">
                    <div>
                      <h3>Test steps</h3>
                      <p>Collapse or expand individual steps while editing. Execution history stays even if this live definition changes later.</p>
                    </div>
                  </div>

                  <div className="action-row">
                    <button className="ghost-button" onClick={() => setExpandedStepIds(steps.map((step) => step.id))} type="button">
                      Expand all
                    </button>
                    <button className="ghost-button" onClick={() => setExpandedStepIds([])} type="button">
                      Collapse all
                    </button>
                  </div>

                  {stepsQuery.isLoading ? <div className="empty-state compact">Loading steps…</div> : null}
                  {!stepsQuery.isLoading && !steps.length ? <div className="empty-state compact">No steps yet for this test case.</div> : null}

                  <div className="step-list">
                    {steps.map((step, index) => (
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
                    <button className="primary-button" type="submit">Add step</button>
                  </form>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty-state compact">Select a test case from the left, or start a new one for this app type.</div>
          )}
        </Panel>
      </div>
    </div>
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
        <div>
          <strong>Step {step.step_order}</strong>
          <span>{draft.action || "No action written yet"}</span>
        </div>
        <span>{isExpanded ? "Hide" : "Show"}</span>
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
