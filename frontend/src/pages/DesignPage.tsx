import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { DataTable } from "../components/DataTable";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import type { TestCase, TestStep, TestSuite } from "../types";

export function DesignPage() {
  const queryClient = useQueryClient();
  const { appTypes, requirements, testSuites, testCases, testSteps } = useWorkspaceData();
  const [selectedAppTypeId, setSelectedAppTypeId] = useState("");
  const [selectedSuiteId, setSelectedSuiteId] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [message, setMessage] = useState("");

  const currentAppTypeId = selectedAppTypeId || appTypes.data?.[0]?.id || "";
  const scopedSuites = useMemo(
    () => (testSuites.data || []).filter((suite) => suite.app_type_id === currentAppTypeId),
    [currentAppTypeId, testSuites.data]
  );
  const currentSuiteId = selectedSuiteId || scopedSuites[0]?.id || "";
  const scopedCases = useMemo(
    () => (testCases.data || []).filter((testCase) => testCase.suite_id === currentSuiteId),
    [currentSuiteId, testCases.data]
  );
  const currentCaseId = selectedCaseId || scopedCases[0]?.id || "";
  const scopedSteps = useMemo(
    () => (testSteps.data || []).filter((step) => step.test_case_id === currentCaseId),
    [currentCaseId, testSteps.data]
  );

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["test-suites"] }),
      queryClient.invalidateQueries({ queryKey: ["test-cases"] }),
      queryClient.invalidateQueries({ queryKey: ["test-steps"] })
    ]);
  };

  const createSuite = useMutation({
    mutationFn: api.testSuites.create,
    onSuccess: async () => {
      setMessage("Test suite created.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to create suite")
  });

  const createCase = useMutation({
    mutationFn: api.testCases.create,
    onSuccess: async () => {
      setMessage("Test case created.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to create case")
  });

  const createStep = useMutation({
    mutationFn: api.testSteps.create,
    onSuccess: async () => {
      setMessage("Test step created.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to create step")
  });

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Test Design"
        title="Shape suites, cases, and executable steps"
        description="Move from app-type boundary to suite hierarchy to test-step detail without leaving context."
      />

      {message ? <p className="inline-message">{message}</p> : null}

      <div className="toolbar-row">
        <select value={currentAppTypeId} onChange={(event) => {
          setSelectedAppTypeId(event.target.value);
          setSelectedSuiteId("");
          setSelectedCaseId("");
        }}>
          {(appTypes.data || []).map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
        <select value={currentSuiteId} onChange={(event) => {
          setSelectedSuiteId(event.target.value);
          setSelectedCaseId("");
        }}>
          {scopedSuites.map((suite) => (
            <option key={suite.id} value={suite.id}>{suite.name}</option>
          ))}
        </select>
        <select value={currentCaseId} onChange={(event) => setSelectedCaseId(event.target.value)}>
          {scopedCases.map((testCase) => (
            <option key={testCase.id} value={testCase.id}>{testCase.title}</option>
          ))}
        </select>
      </div>

      <div className="three-column-grid">
        <Panel title="Suites" subtitle="Container hierarchy per app type">
          <form className="form-grid" onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            createSuite.mutate({
              app_type_id: currentAppTypeId,
              name: String(formData.get("name") || ""),
              parent_id: String(formData.get("parent_id") || "") || undefined
            });
            event.currentTarget.reset();
          }}>
            <FormField label="Suite name">
              <input name="name" required placeholder="Authentication" />
            </FormField>
            <FormField label="Parent suite (optional)">
              <select name="parent_id" defaultValue="">
                <option value="">None</option>
                {scopedSuites.map((suite) => <option key={suite.id} value={suite.id}>{suite.name}</option>)}
              </select>
            </FormField>
            <button className="primary-button" disabled={!currentAppTypeId} type="submit">Add suite</button>
          </form>

          <DataTable<TestSuite>
            emptyMessage="No suites yet."
            rows={scopedSuites}
            columns={[
              { key: "name", label: "Suite", render: (row) => row.name },
              { key: "parent", label: "Parent", render: (row) => row.parent_id || "root" },
              {
                key: "actions",
                label: "Actions",
                render: (row) => <button className="ghost-button danger" onClick={() => void api.testSuites.delete(row.id).then(invalidate).catch((error: Error) => setMessage(error.message))}>Delete</button>
              }
            ]}
          />
        </Panel>

        <Panel title="Cases" subtitle="Requirement-linked executable coverage">
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            createCase.mutate({
              suite_id: currentSuiteId,
              title: String(formData.get("title") || ""),
              description: String(formData.get("description") || ""),
              priority: Number(formData.get("priority") || 3),
              status: String(formData.get("status") || "active"),
              requirement_id: String(formData.get("requirement_id") || "") || undefined
            });
            event.currentTarget.reset();
          }}>
            <FormField label="Case title">
              <input name="title" required />
            </FormField>
            <FormField label="Description">
              <textarea name="description" rows={2} />
            </FormField>
            <FormField label="Priority">
              <input name="priority" defaultValue="3" type="number" />
            </FormField>
            <FormField label="Status">
              <input name="status" defaultValue="active" />
            </FormField>
            <FormField label="Requirement">
              <select name="requirement_id" defaultValue="">
                <option value="">None</option>
                {(requirements.data || []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </FormField>
            <button className="primary-button" disabled={!currentSuiteId} type="submit">Add case</button>
          </form>

          <DataTable<TestCase>
            emptyMessage="No test cases yet."
            rows={scopedCases}
            columns={[
              { key: "title", label: "Case", render: (row) => <div><strong>{row.title}</strong><span>{row.description || "No description"}</span></div> },
              { key: "status", label: "Status", render: (row) => row.status || "active" },
              {
                key: "actions",
                label: "Actions",
                render: (row) => <button className="ghost-button danger" onClick={() => void api.testCases.delete(row.id).then(invalidate).catch((error: Error) => setMessage(error.message))}>Delete</button>
              }
            ]}
          />
        </Panel>

        <Panel title="Steps" subtitle="Operational detail for the selected case">
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            createStep.mutate({
              test_case_id: currentCaseId,
              step_order: Number(formData.get("step_order") || 1),
              action: String(formData.get("action") || ""),
              expected_result: String(formData.get("expected_result") || "")
            });
            event.currentTarget.reset();
          }}>
            <FormField label="Order">
              <input name="step_order" defaultValue="1" type="number" />
            </FormField>
            <FormField label="Action">
              <textarea name="action" rows={2} />
            </FormField>
            <FormField label="Expected result">
              <textarea name="expected_result" rows={2} />
            </FormField>
            <button className="primary-button" disabled={!currentCaseId} type="submit">Add step</button>
          </form>

          <DataTable<TestStep>
            emptyMessage="No steps yet."
            rows={scopedSteps}
            columns={[
              { key: "order", label: "#", render: (row) => row.step_order },
              { key: "action", label: "Action", render: (row) => row.action || "—" },
              { key: "expected", label: "Expected", render: (row) => row.expected_result || "—" },
              {
                key: "actions",
                label: "Actions",
                render: (row) => <button className="ghost-button danger" onClick={() => void api.testSteps.delete(row.id).then(invalidate).catch((error: Error) => setMessage(error.message))}>Delete</button>
              }
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
