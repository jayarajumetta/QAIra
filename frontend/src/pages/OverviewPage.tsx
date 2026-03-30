import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ProgressMeter } from "../components/ProgressMeter";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { useWorkspaceData } from "../hooks/useWorkspaceData";

export function OverviewPage() {
  const navigate = useNavigate();
  const {
    users,
    projects,
    requirements,
    appTypes,
    testSuites,
    testCases,
    executions,
    executionResults
  } = useWorkspaceData();

  const usersList = users.data || [];
  const projectsList = projects.data || [];
  const requirementsList = requirements.data || [];
  const appTypesList = appTypes.data || [];
  const suitesList = testSuites.data || [];
  const testCasesList = testCases.data || [];
  const executionsList = executions.data || [];
  const executionResultsList = executionResults.data || [];

  const executionSummaryById = useMemo(() => {
    const summary: Record<string, { passed: number; failed: number; total: number; percent: number }> = {};

    executionResultsList.forEach((result) => {
      summary[result.execution_id] = summary[result.execution_id] || { passed: 0, failed: 0, total: 0, percent: 0 };
      summary[result.execution_id].total += 1;

      if (result.status === "passed") {
        summary[result.execution_id].passed += 1;
      }

      if (result.status === "failed") {
        summary[result.execution_id].failed += 1;
      }
    });

    Object.values(summary).forEach((item) => {
      item.percent = item.total ? Math.round((item.passed / item.total) * 100) : 0;
    });

    return summary;
  }, [executionResultsList]);

  const passRate = useMemo(() => {
    if (!executionResultsList.length) {
      return 0;
    }

    const passed = executionResultsList.filter((item) => item.status === "passed").length;
    return Math.round((passed / executionResultsList.length) * 100);
  }, [executionResultsList]);

  const requirementCoverage = useMemo(() => {
    if (!requirementsList.length) {
      return 0;
    }

    const mapped = requirementsList.filter((item) => (item.test_case_ids || []).length).length;
    return Math.round((mapped / requirementsList.length) * 100);
  }, [requirementsList]);

  const executionHealth = useMemo(() => {
    const activeExecutions = executionsList.filter((item) => item.status === "running").length;
    const failedExecutions = executionsList.filter((item) => item.status === "failed").length;
    const latestExecutions = executionsList.slice(0, 5);

    return {
      activeExecutions,
      failedExecutions,
      latestExecutions
    };
  }, [executionsList]);

  const coverageGaps = useMemo(() => {
    return requirementsList
      .filter((item) => !(item.test_case_ids || []).length)
      .slice(0, 6);
  }, [requirementsList]);

  const failureWatch = useMemo(() => {
    return executionResultsList
      .filter((result) => result.status === "failed")
      .slice(0, 6);
  }, [executionResultsList]);

  const appHealth = useMemo(() => {
    return appTypesList.map((appType) => {
      const scopedCases = testCasesList.filter((testCase) => testCase.app_type_id === appType.id);
      const scopedSuites = suitesList.filter((suite) => suite.app_type_id === appType.id);
      const scopedResults = executionResultsList.filter((result) => result.app_type_id === appType.id);
      const passed = scopedResults.filter((result) => result.status === "passed").length;
      const percent = scopedResults.length ? Math.round((passed / scopedResults.length) * 100) : 0;

      return {
        id: appType.id,
        name: appType.name,
        project: projectsList.find((project) => project.id === appType.project_id)?.name || "Unknown project",
        suites: scopedSuites.length,
        cases: scopedCases.length,
        percent
      };
    });
  }, [appTypesList, executionResultsList, projectsList, suitesList, testCasesList]);

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Overview"
        title="Delivery Overview"
        description="Track coverage health, execution quality, and app-level readiness from one mature control surface without losing sight of requirements or reusable library depth."
        actions={<button className="primary-button" onClick={() => navigate("/executions")} type="button">Open Execution Hub</button>}
      />

      <div className="stats-grid">
        <StatCard label="Workspace Members" value={usersList.length} hint="People available for design, review, and execution" />
        <StatCard label="Projects" value={projectsList.length} hint="Delivery streams currently active in the workspace" />
        <StatCard label="Requirement Coverage" value={`${requirementCoverage}%`} hint="Requirements with at least one linked test case" />
        <StatCard label="Execution Pass Rate" value={`${passRate}%`} hint="Pass percentage across all recorded execution results" />
        <StatCard label="Running Executions" value={executionHealth.activeExecutions} hint="Runs currently in motion" />
        <StatCard label="Failed Executions" value={executionHealth.failedExecutions} hint="Runs that ended in a failed state" />
      </div>

      <div className="two-column-grid">
        <Panel title="Application health" subtitle="Each app type shows coverage volume and recent execution quality.">
          <div className="stack-list">
            {appHealth.map((item) => (
              <div className="stack-item" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.project}</span>
                  <ProgressMeter detail={`${item.cases} cases · ${item.suites} suites`} value={item.percent} />
                </div>
                <span className="count-pill">{item.percent}%</span>
              </div>
            ))}
            {!appHealth.length ? <div className="empty-state compact">No app types created yet.</div> : null}
          </div>
        </Panel>

        <Panel title="Recent executions" subtitle="The latest runs with visible pass-rate momentum and quick drill-down access.">
          <div className="stack-list">
            {executionHealth.latestExecutions.map((execution) => {
              const summary = executionSummaryById[execution.id] || { passed: 0, failed: 0, total: 0, percent: 0 };

              return (
                <button
                  className="stack-item stack-item-button"
                  key={execution.id}
                  onClick={() => navigate(`/executions?execution=${execution.id}`)}
                  type="button"
                >
                  <div>
                    <strong>{execution.name || "Unnamed execution"}</strong>
                    <span>{projectsList.find((project) => project.id === execution.project_id)?.name || execution.project_id}</span>
                    <ProgressMeter detail={`${summary.passed}/${summary.total} passed · ${summary.failed} failed`} value={summary.percent} />
                  </div>
                  <StatusBadge value={execution.status} />
                </button>
              );
            })}
            {!executionHealth.latestExecutions.length ? <div className="empty-state compact">No executions recorded yet.</div> : null}
          </div>
        </Panel>
      </div>

      <div className="two-column-grid">
        <Panel title="Coverage gaps" subtitle="Requirements still waiting for linked reusable cases.">
          <div className="stack-list">
            {coverageGaps.map((requirement) => (
              <div className="stack-item" key={requirement.id}>
                <div>
                  <strong>{requirement.title}</strong>
                  <span>{requirement.description || "No description provided"}</span>
                </div>
                <span className="count-pill">Needs design</span>
              </div>
            ))}
            {!coverageGaps.length ? <div className="empty-state compact">Every requirement currently has linked test coverage.</div> : null}
          </div>
        </Panel>

        <Panel title="Failure watch" subtitle="Most recent failed execution results that deserve investigation.">
          <div className="stack-list">
            {failureWatch.map((result) => (
              <div className="stack-item" key={result.id}>
                <div>
                  <strong>{result.test_case_title || result.test_case_id}</strong>
                  <span>{result.error || "Failed without an explicit error message"}</span>
                </div>
                <StatusBadge value={result.status} />
              </div>
            ))}
            {!failureWatch.length ? <div className="empty-state compact">No recent failed results. The board is clear.</div> : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}
