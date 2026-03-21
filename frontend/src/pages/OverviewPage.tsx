import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { useWorkspaceData } from "../hooks/useWorkspaceData";

export function OverviewPage() {
  const navigate = useNavigate();
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
  const latestExecutions = (executions.data || []).slice(0, 5);
  const resultsByExecutionId = useMemo(() => {
    const map: Record<string, { passed: number; total: number }> = {};

    (executionResults.data || []).forEach((result) => {
      map[result.execution_id] = map[result.execution_id] || { passed: 0, total: 0 };
      map[result.execution_id].total += 1;
      if (result.status === "passed") {
        map[result.execution_id].passed += 1;
      }
    });

    return map;
  }, [executionResults.data]);

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Overview"
        title="Test Overview"
        description="Keep people, scope, latest runs, and pass-rate signals visible without hopping between pages."
        actions={<button className="primary-button" onClick={() => navigate("/executions")} type="button">View Executions</button>}
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
            {latestExecutions.map((execution) => {
              const stats = resultsByExecutionId[execution.id] || { passed: 0, total: 0 };
              const percent = stats.total ? Math.round((stats.passed / stats.total) * 100) : 0;

              return (
                <button
                  className="stack-item stack-item-button"
                  key={execution.id}
                  onClick={() => navigate(`/executions?execution=${execution.id}`)}
                  type="button"
                >
                  <div>
                    <strong>{execution.name || "Unnamed execution"}</strong>
                    <span>{execution.project_id}</span>
                    <span>{stats.passed}/{stats.total} passed · {percent}%</span>
                  </div>
                  <StatusBadge value={execution.status} />
                </button>
              );
            })}
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
