import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActivityIcon, OpenIcon } from "../components/AppIcons";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ProgressMeter } from "../components/ProgressMeter";
import { StatusBadge } from "../components/StatusBadge";
import { SubnavTabs } from "../components/SubnavTabs";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useAuth } from "../auth/AuthContext";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import type { Integration, WorkspaceTransaction, WorkspaceTransactionArtifact } from "../types";

type TestOpsView = "batch-process" | "ops-telemetry";

const BATCH_PROCESS_CATEGORIES = new Set([
  "bulk_import",
  "bulk_export",
  "ai_generation",
  "backup",
  "automation_build",
  "smart_execution",
  "reporting"
]);

function isBatchProcessTransaction(transaction: WorkspaceTransaction) {
  return BATCH_PROCESS_CATEGORIES.has(transaction.category)
    || transaction.action === "testengine_run"
    || transaction.action === "execution_report_export"
    || transaction.action === "run_report_export";
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(start?: string | null, end?: string | null) {
  if (!start) {
    return "0s";
  }

  const startedAt = new Date(start).getTime();
  const endedAt = end ? new Date(end).getTime() : Date.now();

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) {
    return "0s";
  }

  const seconds = Math.round((endedAt - startedAt) / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (!minutes) {
    return `${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return hours ? `${hours}h ${remainingMinutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function readNumberMetadata(transaction: WorkspaceTransaction | null, key: string) {
  const value = transaction?.metadata?.[key];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function resolveProgressPercent(transaction: WorkspaceTransaction | null) {
  if (!transaction) {
    return 0;
  }

  const explicit = readNumberMetadata(transaction, "progress_percent");

  if (explicit) {
    return Math.max(0, Math.min(100, explicit));
  }

  const total = readNumberMetadata(transaction, "total_items") || readNumberMetadata(transaction, "total_rows");
  const processed = readNumberMetadata(transaction, "processed_items");

  if (!total) {
    return transaction.status === "completed" ? 100 : 0;
  }

  return Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
}

function formatProgressDetail(transaction: WorkspaceTransaction | null) {
  if (!transaction) {
    return "";
  }

  const total = readNumberMetadata(transaction, "total_items") || readNumberMetadata(transaction, "total_rows");
  const processed = readNumberMetadata(transaction, "processed_items");
  const imported = readNumberMetadata(transaction, "imported") || readNumberMetadata(transaction, "exported");
  const failed = readNumberMetadata(transaction, "failed");

  return [
    total ? `${processed}/${total} processed` : "",
    imported ? `${imported} succeeded` : "",
    failed ? `${failed} failed` : ""
  ].filter(Boolean).join(" · ");
}

function formatLabel(value?: string | null) {
  return String(value || "unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildReadableUrl(baseUrl?: string | null, path = "/ops-telemetry") {
  if (!baseUrl) {
    return "";
  }

  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return "";
  }
}

function resolveScopedIntegration(integrations: Integration[], type: Integration["type"], projectId: string) {
  const active = integrations.filter((integration) => integration.type === type && integration.is_active);
  const scoped = projectId
    ? active.find((integration) => String(integration.config?.project_id || "") === projectId)
    : null;

  return scoped || active.find((integration) => !String(integration.config?.project_id || "").trim()) || active[0] || null;
}

export function TestOpsPage() {
  const { session } = useAuth();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useState("");
  const [view, setView] = useState<TestOpsView>("batch-process");
  const [selectedTransactionId, setSelectedTransactionId] = useState("");

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list,
    enabled: Boolean(session)
  });
  const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: () => api.appTypes.list({ project_id: projectId }),
    enabled: Boolean(projectId && session)
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations", "testops"],
    queryFn: () => api.integrations.list({ is_active: true }),
    enabled: Boolean(session)
  });
  const transactionsQuery = useQuery({
    queryKey: ["workspace-transactions", "testops", projectId, appTypeId],
    queryFn: () => api.workspaceTransactions.list({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined,
      include_global: true,
      limit: 150
    }),
    enabled: Boolean(projectId && session),
    refetchInterval: (query) =>
      Array.isArray(query.state.data) && query.state.data.some((transaction) => ["queued", "running"].includes(transaction.status))
        ? 15_000
        : false
  });
  const transactionEventsQuery = useQuery({
    queryKey: ["workspace-transaction-events", "testops", selectedTransactionId],
    queryFn: () => api.workspaceTransactions.events(selectedTransactionId),
    enabled: Boolean(selectedTransactionId && session),
    refetchInterval: 15_000
  });
  const transactionArtifactsQuery = useQuery({
    queryKey: ["workspace-transaction-artifacts", "testops", selectedTransactionId],
    queryFn: () => api.workspaceTransactions.artifacts(selectedTransactionId),
    enabled: Boolean(selectedTransactionId && session),
    refetchInterval: 15_000
  });

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const integrations = integrationsQuery.data || [];
  const batchTransactions = useMemo(
    () => (transactionsQuery.data || []).filter(isBatchProcessTransaction),
    [transactionsQuery.data]
  );
  const selectedTransaction = batchTransactions.find((transaction) => transaction.id === selectedTransactionId) || null;
  const testEngineIntegration = resolveScopedIntegration(integrations, "testengine", projectId);
  const opsIntegration = resolveScopedIntegration(integrations, "ops", projectId);
  const opsBoardUrl = buildReadableUrl(testEngineIntegration?.base_url, "/ops-telemetry");
  const runningCount = batchTransactions.filter((transaction) => transaction.status === "queued" || transaction.status === "running").length;
  const failedCount = batchTransactions.filter((transaction) => transaction.status === "failed").length;

  const handleDownloadArtifact = async (artifact: WorkspaceTransactionArtifact) => {
    if (!selectedTransaction) {
      return;
    }

    const blob = await api.workspaceTransactions.downloadArtifact(selectedTransaction.id, artifact.id);
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = href;
    link.download = artifact.file_name || "artifact";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="page-content page-content--testops">
      <PageHeader
        eyebrow="TestOps"
        title="TestOps"
        description="Monitor background test operations and open the OPS telemetry board without leaving QAira."
        meta={[
          { label: "Batch records", value: batchTransactions.length },
          { label: "Running", value: runningCount },
          { label: "OPS board", value: opsBoardUrl ? "Ready" : "Not configured" }
        ]}
      />

      <SubnavTabs
        ariaLabel="TestOps views"
        items={[
          { value: "batch-process", label: "Batch Process", meta: `${batchTransactions.length}`, icon: <ActivityIcon /> },
          { value: "ops-telemetry", label: "OPS Telemetry", meta: opsBoardUrl ? "iframe" : "setup", icon: <ActivityIcon /> }
        ]}
        onChange={setView}
        value={view}
      />

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={setAppTypeId}
        onProjectChange={(value) => {
          setProjectId(value);
          setAppTypeId("");
          setSelectedTransactionId("");
        }}
        projectId={projectId}
        projects={projects}
      />

      {view === "batch-process" ? (
        <div className="testops-layout">
          <Panel
            className="testops-panel"
            title="Batch process"
            subtitle="Imports, exports, automation handoffs, generated cases, reports, and sync work appear here with their latest trace state."
          >
            {transactionsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {!transactionsQuery.isLoading && batchTransactions.length ? (
              <div className="testops-operation-grid">
                {batchTransactions.map((transaction) => (
                  <button
                    className={selectedTransactionId === transaction.id ? "record-card tile-card is-active" : "record-card tile-card"}
                    key={transaction.id}
                    onClick={() => setSelectedTransactionId(transaction.id)}
                    type="button"
                  >
                    <div className="tile-card-main">
                      <div className="tile-card-header">
                        <span className="integration-type-badge"><ActivityIcon size={18} /></span>
                        <div className="tile-card-title-group">
                          <strong>{transaction.title}</strong>
                          <span className="tile-card-kicker">{formatLabel(transaction.action)}</span>
                        </div>
                        <StatusBadge value={transaction.status} />
                      </div>
                      <p className="tile-card-description">{transaction.description || formatLabel(transaction.category)}</p>
                      <ProgressMeter
                        value={resolveProgressPercent(transaction)}
                        label={formatLabel(String(transaction.metadata?.current_phase || transaction.status))}
                        detail={formatProgressDetail(transaction)}
                        tone={transaction.status === "failed" ? "danger" : transaction.status === "completed" ? "success" : "info"}
                      />
                      <div className="integration-card-footer">
                        <span className="count-pill">{transaction.event_count || 0} events</span>
                        <span className="count-pill">
                          {formatDuration(transaction.started_at || transaction.created_at, transaction.completed_at || transaction.updated_at)}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            {!transactionsQuery.isLoading && !batchTransactions.length ? (
              <div className="empty-state compact">No batch process records have been recorded for this scope yet.</div>
            ) : null}
          </Panel>

          <Panel
            className="testops-panel testops-detail-panel"
            title={selectedTransaction ? selectedTransaction.title : "Process trace"}
            subtitle={selectedTransaction ? "The latest metadata and event timeline for this operation." : "Choose a batch process card to inspect its trace."}
          >
            {selectedTransaction ? (
              <div className="detail-stack">
                <div className="metric-strip compact">
                  <div className="mini-card">
                    <strong>{selectedTransaction.status}</strong>
                    <span>Status</span>
                  </div>
                  <div className="mini-card">
                    <strong>{selectedTransaction.event_count || 0}</strong>
                    <span>Events</span>
                  </div>
                  <div className="mini-card">
                    <strong>{failedCount}</strong>
                    <span>Failures in scope</span>
                  </div>
                  <div className="mini-card">
                    <strong>{resolveProgressPercent(selectedTransaction)}%</strong>
                    <span>Progress</span>
                  </div>
                </div>
                <ProgressMeter
                  value={resolveProgressPercent(selectedTransaction)}
                  label={formatLabel(String(selectedTransaction.metadata?.current_phase || selectedTransaction.status))}
                  detail={formatProgressDetail(selectedTransaction)}
                  tone={selectedTransaction.status === "failed" ? "danger" : selectedTransaction.status === "completed" ? "success" : "info"}
                />
                <div className="stack-list">
                  <div className="stack-item">
                    <div>
                      <strong>Category</strong>
                      <span>{formatLabel(selectedTransaction.category)}</span>
                    </div>
                    <StatusBadge value={selectedTransaction.status} />
                  </div>
                  <div className="stack-item">
                    <div>
                      <strong>Latest activity</strong>
                      <span>{formatTimestamp(selectedTransaction.latest_event_at || selectedTransaction.updated_at)}</span>
                    </div>
                  </div>
                  {Object.keys(selectedTransaction.metadata || {}).length ? (
                    <div className="stack-item execution-operation-metadata">
                      <div>
                        <strong>Metadata</strong>
                        <span>Structured context emitted by the operation.</span>
                      </div>
                      <code className="execution-operation-json">{JSON.stringify(selectedTransaction.metadata, null, 2)}</code>
                    </div>
                  ) : null}
                </div>

                {(transactionArtifactsQuery.data || []).length ? (
                  <div className="stack-list">
                    {(transactionArtifactsQuery.data || []).map((artifact) => (
                      <div className="stack-item" key={artifact.id}>
                        <div>
                          <strong>{artifact.file_name}</strong>
                          <span>{artifact.mime_type} · {formatTimestamp(artifact.created_at)}</span>
                        </div>
                        <button className="ghost-button" onClick={() => void handleDownloadArtifact(artifact)} type="button">
                          <OpenIcon size={16} />
                          <span>Download</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="execution-context-summary-head">
                  <div className="execution-context-summary-copy">
                    <strong>Trace log</strong>
                    <span>Recorded operation stages in chronological order.</span>
                  </div>
                  <span className="count-pill">{(transactionEventsQuery.data || []).length} events</span>
                </div>

                {transactionEventsQuery.isLoading ? <div className="empty-state compact">Loading process events...</div> : null}
                {!transactionEventsQuery.isLoading && !(transactionEventsQuery.data || []).length ? (
                  <div className="empty-state compact">No events have been recorded for this process yet.</div>
                ) : null}
                {(transactionEventsQuery.data || []).length ? (
                  <div className="stack-list execution-activity-list">
                    {(transactionEventsQuery.data || []).map((event) => (
                      <details className="stack-item execution-operation-event" key={event.id}>
                        <summary className="execution-operation-event-summary">
                          <div>
                            <strong>{event.message}</strong>
                            <span>{event.phase ? `${event.phase} · ` : ""}{formatTimestamp(event.created_at)}</span>
                          </div>
                          <span className={`status-badge ${event.level}`}>{event.level}</span>
                        </summary>
                        {Object.keys(event.details || {}).length ? (
                          <code className="execution-operation-json">{JSON.stringify(event.details, null, 2)}</code>
                        ) : null}
                      </details>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-state compact">Choose a process card to review its metadata and trace log.</div>
            )}
          </Panel>
        </div>
      ) : (
        <Panel
          className="testops-panel testops-telemetry-panel"
          title="OPS telemetry"
          subtitle={opsIntegration ? `Using ${opsIntegration.name}` : "Configure an active OPS telemetry integration and Test Engine host to load the board."}
          actions={
            opsBoardUrl ? (
              <a className="ghost-button" href={opsBoardUrl} rel="noreferrer" target="_blank">
                <OpenIcon />
                Open board
              </a>
            ) : undefined
          }
        >
          {opsBoardUrl ? (
            <iframe
              className="testops-telemetry-frame"
              src={opsBoardUrl}
              title="OPS telemetry dashboard"
            />
          ) : (
            <div className="empty-state compact">
              Activate a Test Engine integration for this project so QAira can resolve the hosted OPS telemetry board.
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
