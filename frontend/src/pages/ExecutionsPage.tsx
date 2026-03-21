import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import { SubnavTabs } from "../components/SubnavTabs";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import { api } from "../lib/api";
import type { ExecutionResult } from "../types";

type ExecutionSection = "runs" | "results";

export function ExecutionsPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { projects, testCases, appTypes, executions, executionResults, users } = useWorkspaceData();
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const [section, setSection] = useState<ExecutionSection>("runs");
  const [message, setMessage] = useState("");

  const executionItems = executions.data || [];
  const currentExecution = useMemo(
    () => executionItems.find((item) => item.id === selectedExecutionId) || executionItems[0],
    [executionItems, selectedExecutionId]
  );
  const currentExecutionId = currentExecution?.id || "";

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
        title="Operate runs with a calmer control surface"
        description="Keep run creation, lifecycle controls, and captured evidence in separate lanes so active execution work stays quick to scan."
      />

      {message ? <p className="inline-message">{message}</p> : null}

      <div className="workspace-grid">
        <Panel title="Run list" subtitle="Select an execution to manage lifecycle or review evidence.">
          <form
            className="form-grid"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              createExecution.mutate({
                project_id: String(formData.get("project_id") || ""),
                name: String(formData.get("name") || ""),
                created_by: session!.user.id
              });
              event.currentTarget.reset();
            }}
          >
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

          <div className="record-list">
            {executionItems.map((execution) => (
              <button
                key={execution.id}
                className={currentExecution?.id === execution.id ? "record-card is-active" : "record-card"}
                onClick={() => setSelectedExecutionId(execution.id)}
                type="button"
              >
                <div>
                  <strong>{execution.name || "Unnamed execution"}</strong>
                  <span>{projects.data?.find((project) => project.id === execution.project_id)?.name || execution.project_id}</span>
                </div>
                <StatusBadge value={execution.status} />
              </button>
            ))}
          </div>
          {!executionItems.length ? <div className="empty-state compact">No executions yet.</div> : null}
        </Panel>

        <div className="stack-grid">
          <Panel title="Selected execution" subtitle={currentExecution ? "Execution summary and lifecycle actions." : "Create or select a run to continue."}>
            {currentExecution ? (
              <div className="detail-stack">
                <div className="detail-summary">
                  <strong>{currentExecution.name || "Unnamed execution"}</strong>
                  <span>{projects.data?.find((project) => project.id === currentExecution.project_id)?.name || currentExecution.project_id}</span>
                </div>
                <div className="metric-strip">
                  <div className="mini-card">
                    <strong>{scopedResults.length}</strong>
                    <span>Recorded results</span>
                  </div>
                  <div className="mini-card">
                    <strong>{currentExecution.started_at ? "Started" : "Pending"}</strong>
                    <span>{currentExecution.started_at || "Not started"}</span>
                  </div>
                  <div className="mini-card">
                    <strong>{currentExecution.ended_at ? "Ended" : "Open"}</strong>
                    <span>{currentExecution.ended_at || "Still active"}</span>
                  </div>
                </div>
                <div className="action-row">
                  <button
                    className="ghost-button"
                    onClick={() => void api.executions.start(currentExecution.id).then(invalidate).catch((error: Error) => setMessage(error.message))}
                    type="button"
                  >
                    Start run
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => void api.executions.complete(currentExecution.id, { status: "completed" }).then(invalidate).catch((error: Error) => setMessage(error.message))}
                    type="button"
                  >
                    Complete run
                  </button>
                  <button
                    className="ghost-button danger"
                    onClick={() => void api.executions.delete(currentExecution.id).then(invalidate).catch((error: Error) => setMessage(error.message))}
                    type="button"
                  >
                    Delete run
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty-state compact">No run selected.</div>
            )}
          </Panel>

          <SubnavTabs
            value={section}
            onChange={setSection}
            items={[
              { value: "runs", label: "Run Activity", meta: `${executionItems.length}` },
              { value: "results", label: "Results", meta: `${scopedResults.length}` }
            ]}
          />

          {section === "runs" ? (
            <Panel title="Run activity" subtitle="A simple activity board for the selected execution.">
              {currentExecution ? (
                <div className="record-grid">
                  <article className="mini-card">
                    <strong>Status</strong>
                    <span>{currentExecution.status || "queued"}</span>
                  </article>
                  <article className="mini-card">
                    <strong>Trigger</strong>
                    <span>{currentExecution.trigger || "manual"}</span>
                  </article>
                  <article className="mini-card">
                    <strong>Created by</strong>
                    <span>{users.data?.find((user) => user.id === currentExecution.created_by)?.email || currentExecution.created_by || "n/a"}</span>
                  </article>
                </div>
              ) : (
                <div className="empty-state compact">Select a run to view activity.</div>
              )}
            </Panel>
          ) : null}

          {section === "results" ? (
            <Panel title="Execution results" subtitle={currentExecutionId ? "Record or adjust evidence for the active run." : "Select an execution first."}>
              <form
                className="form-grid"
                onSubmit={(event) => {
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
                }}
              >
                <div className="record-grid">
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
                    <textarea name="logs" rows={3} />
                  </FormField>
                </div>
                <button className="primary-button" disabled={!currentExecutionId} type="submit">Add result</button>
              </form>

              <div className="record-grid">
                {scopedResults.map((row) => (
                  <article className="mini-card" key={row.id}>
                    <strong>{testCases.data?.find((item) => item.id === row.test_case_id)?.title || row.test_case_id}</strong>
                    <span>{appTypes.data?.find((item) => item.id === row.app_type_id)?.name || row.app_type_id}</span>
                    <span>{row.status} · {row.duration_ms ? `${row.duration_ms} ms` : "No duration"}</span>
                    <span>{row.error || row.logs || "No extra evidence"}</span>
                    <div className="action-row">
                      <button
                        className="ghost-button"
                        onClick={() => void api.executionResults.update(row.id, { status: "failed" }).then(invalidate).catch((error: Error) => setMessage(error.message))}
                        type="button"
                      >
                        Mark failed
                      </button>
                      <button
                        className="ghost-button danger"
                        onClick={() => void api.executionResults.delete(row.id).then(invalidate).catch((error: Error) => setMessage(error.message))}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!scopedResults.length ? <div className="empty-state compact">No results captured for this execution.</div> : null}
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
