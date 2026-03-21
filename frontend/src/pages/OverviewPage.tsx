import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { useWorkspaceData } from "../hooks/useWorkspaceData";

export function OverviewPage() {
  const {
    users,
    projects,
    requirements,
    testCases,
    executions,
    executionResults
  } = useWorkspaceData();

  const totalFailures = executionResults.data?.filter((item) => item.status === "failed").length || 0;
  const activeExecutions = executions.data?.filter((item) => item.status === "running").length || 0;

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Overview"
        title="Delivery health at a glance"
        description="Keep people, coverage, and run-state visible without jumping across separate admin surfaces."
      />

      <div className="stats-grid">
        <StatCard label="Users" value={users.data?.length || 0} hint="Workspace members available for assignment" />
        <StatCard label="Projects" value={projects.data?.length || 0} hint="Delivery streams currently tracked" />
        <StatCard label="Requirements" value={requirements.data?.length || 0} hint="Functional scope connected to design" />
        <StatCard label="Test Cases" value={testCases.data?.length || 0} hint="Executable coverage mapped into suites" />
        <StatCard label="Running Executions" value={activeExecutions} hint="Runs currently in motion" />
        <StatCard label="Failed Results" value={totalFailures} hint="Signals needing investigation right now" />
      </div>

      <div className="two-column-grid">
        <Panel title="Recent executions" subtitle="Latest run records from the API">
          <div className="stack-list">
            {(executions.data || []).slice(0, 5).map((execution) => (
              <div className="stack-item" key={execution.id}>
                <div>
                  <strong>{execution.name || "Unnamed execution"}</strong>
                  <span>{execution.project_id}</span>
                </div>
                <StatusBadge value={execution.status} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Failure watch" subtitle="Most recent failed execution results">
          <div className="stack-list">
            {(executionResults.data || [])
              .filter((result) => result.status === "failed")
              .slice(0, 5)
              .map((result) => (
                <div className="stack-item" key={result.id}>
                  <div>
                    <strong>{result.test_case_id}</strong>
                    <span>{result.error || "Result marked failed without error text"}</span>
                  </div>
                  <StatusBadge value={result.status} />
                </div>
              ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
