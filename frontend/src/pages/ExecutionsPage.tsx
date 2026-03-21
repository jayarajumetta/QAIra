import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { DataTable } from "../components/DataTable";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import { api } from "../lib/api";
import type { Execution, ExecutionResult } from "../types";

export function ExecutionsPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { projects, testCases, appTypes, executions, executionResults, users } = useWorkspaceData();
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const [message, setMessage] = useState("");

  const currentExecutionId = selectedExecutionId || executions.data?.[0]?.id || "";
  const scopedResults = useMemo(
    () => (executionResults.data || []).filter((result) => result.execution_id === currentExecutionId),
    [currentExecutionId, executionResults.data]
  );

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["executions"] }),
      queryClient.invalidateQueries({ queryKey: ["execution-results"] })
    ]);
  };

  const createExecution = useMutation({
    mutationFn: api.executions.create,
    onSuccess: async () => {
      setMessage("Execution created.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to create execution")
  });

  const createResult = useMutation({
    mutationFn: api.executionResults.create,
    onSuccess: async () => {
      setMessage("Execution result recorded.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to create result")
  });

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Executions"
        title="Operate test runs and capture evidence"
        description="Start runs, complete them, and record per-case results with explicit platform context."
      />

      {message ? <p className="inline-message">{message}</p> : null}

      <div className="two-column-grid">
        <Panel title="Create execution" subtitle="Runs are currently manual and project-scoped">
          <form className="form-grid" onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            createExecution.mutate({
              project_id: String(formData.get("project_id") || ""),
              name: String(formData.get("name") || ""),
              created_by: session!.user.id
            });
            event.currentTarget.reset();
          }}>
            <FormField label="Project">
              <select name="project_id" required defaultValue="">
                <option value="" disabled>Select project</option>
                {(projects.data || []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </FormField>
            <FormField label="Execution name">
              <input name="name" placeholder="Regression cycle 12" />
            </FormField>
            <button className="primary-button" type="submit">Create execution</button>
          </form>

          <DataTable<Execution>
            emptyMessage="No executions yet."
            rows={executions.data || []}
            columns={[
              {
                key: "name",
                label: "Run",
                render: (row) => (
                  <button className="link-button" onClick={() => setSelectedExecutionId(row.id)}>
                    {row.name || row.id}
                  </button>
                )
              },
              { key: "status", label: "Status", render: (row) => <StatusBadge value={row.status} /> },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <div className="action-row">
                    <button className="ghost-button" onClick={() => void api.executions.start(row.id).then(invalidate).catch((error: Error) => setMessage(error.message))}>
                      Start
                    </button>
                    <button className="ghost-button" onClick={() => void api.executions.complete(row.id, { status: "completed" }).then(invalidate).catch((error: Error) => setMessage(error.message))}>
                      Complete
                    </button>
                    <button className="ghost-button danger" onClick={() => void api.executions.delete(row.id).then(invalidate).catch((error: Error) => setMessage(error.message))}>
                      Delete
                    </button>
                  </div>
                )
              }
            ]}
          />
        </Panel>

        <Panel title="Execution results" subtitle={currentExecutionId ? `Recording evidence for ${currentExecutionId}` : "Select an execution first"}>
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            createResult.mutate({
              execution_id: currentExecutionId,
              test_case_id: String(formData.get("test_case_id") || ""),
              app_type_id: String(formData.get("app_type_id") || ""),
              status: String(formData.get("status") || "passed") as ExecutionResult["status"],
              duration_ms: Number(formData.get("duration_ms") || 0) || undefined,
              error: String(formData.get("error") || "") || undefined,
              logs: String(formData.get("logs") || "") || undefined,
              executed_by: session!.user.id
            });
            event.currentTarget.reset();
          }}>
            <FormField label="Test case">
              <select name="test_case_id" required defaultValue="">
                <option value="" disabled>Select case</option>
                {(testCases.data || []).map((testCase) => <option key={testCase.id} value={testCase.id}>{testCase.title}</option>)}
              </select>
            </FormField>
            <FormField label="App type">
              <select name="app_type_id" required defaultValue="">
                <option value="" disabled>Select app type</option>
                {(appTypes.data || []).map((appType) => <option key={appType.id} value={appType.id}>{appType.name}</option>)}
              </select>
            </FormField>
            <FormField label="Status">
              <select name="status" defaultValue="passed">
                <option value="passed">passed</option>
                <option value="failed">failed</option>
                <option value="blocked">blocked</option>
              </select>
            </FormField>
            <FormField label="Duration (ms)">
              <input name="duration_ms" type="number" />
            </FormField>
            <FormField label="Error">
              <input name="error" placeholder="Optional failure text" />
            </FormField>
            <FormField label="Logs">
              <textarea name="logs" rows={2} />
            </FormField>
            <button className="primary-button" disabled={!currentExecutionId} type="submit">Add result</button>
          </form>

          <DataTable<ExecutionResult>
            emptyMessage="No results captured for this execution."
            rows={scopedResults}
            columns={[
              { key: "case", label: "Case", render: (row) => testCases.data?.find((item) => item.id === row.test_case_id)?.title || row.test_case_id },
              { key: "status", label: "Status", render: (row) => <StatusBadge value={row.status} /> },
              { key: "operator", label: "Executed by", render: (row) => users.data?.find((item) => item.id === row.executed_by)?.email || row.executed_by || "n/a" },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <div className="action-row">
                    <button className="ghost-button" onClick={() => void api.executionResults.update(row.id, { status: "failed" }).then(invalidate).catch((error: Error) => setMessage(error.message))}>
                      Mark failed
                    </button>
                    <button className="ghost-button danger" onClick={() => void api.executionResults.delete(row.id).then(invalidate).catch((error: Error) => setMessage(error.message))}>
                      Delete
                    </button>
                  </div>
                )
              }
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
