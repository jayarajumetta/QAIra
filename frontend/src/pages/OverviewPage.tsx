import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ProgressMeter } from "../components/ProgressMeter";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { useWorkspaceData } from "../hooks/useWorkspaceData";

type DashboardTone = "success" | "info" | "neutral" | "error";

const compactNumberFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1
});

const monthFormatter = new Intl.DateTimeFormat("en", { month: "short" });

const EMPTY_EXECUTION_SUMMARY = {
  passed: 0,
  failed: 0,
  blocked: 0,
  total: 0,
  percent: 0
};

function latestExecutionTimestamp(execution: { started_at?: string | null; ended_at?: string | null }) {
  return Math.max(
    execution.started_at ? new Date(execution.started_at).getTime() || 0 : 0,
    execution.ended_at ? new Date(execution.ended_at).getTime() || 0 : 0
  );
}

function resolveScoreTone(score: number): DashboardTone {
  if (score >= 80) {
    return "success";
  }

  if (score >= 60) {
    return "info";
  }

  if (score >= 40) {
    return "neutral";
  }

  return "error";
}

function scoreAccent(tone: DashboardTone) {
  if (tone === "success") {
    return "#1aa96b";
  }

  if (tone === "info") {
    return "#2d66e6";
  }

  if (tone === "neutral") {
    return "#e49c2f";
  }

  return "#d04668";
}

function buildExecutionSegments(
  passedCount: number,
  failedCount: number,
  blockedCount: number,
  totalCount: number
) {
  if (!totalCount) {
    return [{ value: 100, tone: "neutral" as const }];
  }

  const pendingCount = Math.max(totalCount - passedCount - failedCount - blockedCount, 0);

  return [
    { value: (passedCount / totalCount) * 100, tone: "success" as const },
    { value: (failedCount / totalCount) * 100, tone: "danger" as const },
    { value: (blockedCount / totalCount) * 100, tone: "info" as const },
    { value: (pendingCount / totalCount) * 100, tone: "neutral" as const }
  ].filter((segment) => segment.value > 0);
}

function DashboardToneChip({
  label,
  tone
}: {
  label: string;
  tone: DashboardTone;
}) {
  return <span className={`dashboard-tone-chip tone-${tone}`}>{label}</span>;
}

export function OverviewPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const {
    projects,
    requirements,
    appTypes,
    testSuites,
    testCases,
    testSteps,
    executions,
    executionResults
  } = useWorkspaceData();

  const projectsList = projects.data || [];
  const requirementsList = requirements.data || [];
  const appTypesList = appTypes.data || [];
  const suitesList = testSuites.data || [];
  const testCasesList = testCases.data || [];
  const testStepsList = testSteps.data || [];
  const executionsList = executions.data || [];
  const executionResultsList = executionResults.data || [];

  const caseStepCountById = useMemo(() => {
    return testStepsList.reduce<Record<string, number>>((counts, step) => {
      counts[step.test_case_id] = (counts[step.test_case_id] || 0) + 1;
      return counts;
    }, {});
  }, [testStepsList]);

  const executionSummaryById = useMemo(() => {
    const summary: Record<string, typeof EMPTY_EXECUTION_SUMMARY> = {};

    executionResultsList.forEach((result) => {
      summary[result.execution_id] = summary[result.execution_id] || { ...EMPTY_EXECUTION_SUMMARY };
      summary[result.execution_id].total += 1;

      if (result.status === "passed") {
        summary[result.execution_id].passed += 1;
      } else if (result.status === "failed") {
        summary[result.execution_id].failed += 1;
      } else if (result.status === "blocked") {
        summary[result.execution_id].blocked += 1;
      }
    });

    Object.values(summary).forEach((item) => {
      item.percent = item.total ? Math.round((item.passed / item.total) * 100) : 0;
    });

    return summary;
  }, [executionResultsList]);

  const mappedRequirementsCount = useMemo(
    () => requirementsList.filter((item) => (item.test_case_ids || []).length).length,
    [requirementsList]
  );

  const requirementCoverage = useMemo(() => {
    if (!requirementsList.length) {
      return 0;
    }

    return Math.round((mappedRequirementsCount / requirementsList.length) * 100);
  }, [mappedRequirementsCount, requirementsList]);

  const casesWithStepsCount = useMemo(
    () => testCasesList.filter((testCase) => (caseStepCountById[testCase.id] || 0) > 0).length,
    [caseStepCountById, testCasesList]
  );

  const automationReadiness = useMemo(() => {
    if (!testCasesList.length) {
      return 0;
    }

    return Math.round((casesWithStepsCount / testCasesList.length) * 100);
  }, [casesWithStepsCount, testCasesList]);

  const executionStatusCounts = useMemo(() => {
    return executionsList.reduce(
      (counts, execution) => {
        const key = execution.status || "queued";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      },
      { queued: 0, running: 0, completed: 0, failed: 0 } as Record<string, number>
    );
  }, [executionsList]);

  const resultStatusCounts = useMemo(() => {
    return executionResultsList.reduce(
      (counts, result) => {
        counts[result.status] += 1;
        counts.total += 1;
        return counts;
      },
      { passed: 0, failed: 0, blocked: 0, total: 0 }
    );
  }, [executionResultsList]);

  const passRate = useMemo(() => {
    if (!resultStatusCounts.total) {
      return 0;
    }

    return Math.round((resultStatusCounts.passed / resultStatusCounts.total) * 100);
  }, [resultStatusCounts]);

  const releaseReadinessScore = useMemo(
    () => Math.round((requirementCoverage * 0.4) + (automationReadiness * 0.25) + (passRate * 0.35)),
    [automationReadiness, passRate, requirementCoverage]
  );

  const readinessTone = resolveScoreTone(releaseReadinessScore);
  const readinessRingStyle = {
    background: `conic-gradient(${scoreAccent(readinessTone)} 0 ${releaseReadinessScore}%, rgba(18, 40, 75, 0.08) ${releaseReadinessScore}% 100%)`
  };

  const readinessLabel = useMemo(() => {
    if (releaseReadinessScore >= 85) {
      return "Ready for release review";
    }

    if (releaseReadinessScore >= 65) {
      return "Quality hardening in progress";
    }

    if (releaseReadinessScore >= 45) {
      return "Needs focused follow-up";
    }

    return "Too much release risk";
  }, [releaseReadinessScore]);

  const readinessNarrative = useMemo(() => {
    if (!projectsList.length && !requirementsList.length && !testCasesList.length) {
      return "Start by defining release scope, shaping reusable suites, and capturing the first execution signal.";
    }

    if (releaseReadinessScore >= 85) {
      return "Coverage depth, executable low-code steps, and recent release evidence are strong enough for confident product conversations.";
    }

    if (releaseReadinessScore >= 65) {
      return "The release picture is taking shape, but a few design and execution gaps still stand between status reporting and confidence.";
    }

    return "The product story is still missing enough coverage or run evidence that the dashboard should drive action before release calls.";
  }, [projectsList.length, releaseReadinessScore, requirementsList.length, testCasesList.length]);

  const coverageGaps = useMemo(() => {
    return requirementsList
      .filter((item) => !(item.test_case_ids || []).length)
      .sort((left, right) => (left.priority ?? 3) - (right.priority ?? 3) || left.title.localeCompare(right.title))
      .slice(0, 6);
  }, [requirementsList]);
  const coverageGapCount = Math.max(requirementsList.length - mappedRequirementsCount, 0);

  const casesWithoutSteps = useMemo(() => {
    return testCasesList
      .filter((testCase) => !(caseStepCountById[testCase.id] || 0))
      .sort((left, right) => (left.priority ?? 3) - (right.priority ?? 3) || left.title.localeCompare(right.title))
      .slice(0, 6);
  }, [caseStepCountById, testCasesList]);
  const casesMissingStepsCount = Math.max(testCasesList.length - casesWithStepsCount, 0);

  const recentExecutions = useMemo(() => {
    return [...executionsList]
      .sort((left, right) => latestExecutionTimestamp(right) - latestExecutionTimestamp(left))
      .slice(0, 6)
      .map((execution) => ({
        ...execution,
        summary: executionSummaryById[execution.id] || { ...EMPTY_EXECUTION_SUMMARY },
        projectName: projectsList.find((project) => project.id === execution.project_id)?.name || execution.project_id,
        appTypeName: appTypesList.find((appType) => appType.id === execution.app_type_id)?.name || "Shared scope"
      }));
  }, [appTypesList, executionSummaryById, executionsList, projectsList]);

  const quickActions = useMemo(() => {
    return [
      {
        id: "coverage",
        title: "Close coverage gaps",
        detail: "Map missing requirements to reusable cases or AI-assisted drafts before the next review.",
        meta: `${coverageGapCount} uncovered requirement${coverageGapCount === 1 ? "" : "s"}`,
        to: "/requirements",
        tone: coverageGapCount ? "error" as const : "success" as const
      },
      {
        id: "design",
        title: "Shape suite flows",
        detail: "Curate release-ready suite structure, ordering, and reuse in the suite studio.",
        meta: `${suitesList.length} suite${suitesList.length === 1 ? "" : "s"} live`,
        to: "/design",
        tone: suitesList.length ? "info" as const : "neutral" as const
      },
      {
        id: "automation",
        title: "Deepen automation",
        detail: "Turn reusable cases into executable low-code assets by adding steps and expected results.",
        meta: `${casesMissingStepsCount} case${casesMissingStepsCount === 1 ? "" : "s"} missing steps`,
        to: "/test-cases",
        tone: casesMissingStepsCount ? "info" as const : "success" as const
      },
      {
        id: "executions",
        title: "Run release checks",
        detail: "Open the execution hub to triage failed runs, monitor active checks, and capture new evidence.",
        meta: `${executionStatusCounts.running} running · ${executionStatusCounts.failed} failed`,
        to: "/executions",
        tone: executionStatusCounts.failed ? "error" as const : executionStatusCounts.running ? "info" as const : "success" as const
      }
    ];
  }, [casesMissingStepsCount, coverageGapCount, executionStatusCounts.failed, executionStatusCounts.running, suitesList.length]);

  const attentionQueue = useMemo(() => {
    const failedExecutions = recentExecutions
      .filter((execution) => execution.status === "failed")
      .slice(0, 2)
      .map((execution) => ({
        id: `execution-${execution.id}`,
        title: execution.name || "Unnamed execution",
        detail: `${execution.projectName} release check ended failed and needs triage in the execution hub.`,
        label: "Investigate run",
        tone: "error" as const,
        to: `/executions?execution=${execution.id}`
      }));

    const requirementItems = coverageGaps.slice(0, 3).map((requirement) => ({
      id: `requirement-${requirement.id}`,
      title: requirement.title,
      detail: `Priority P${requirement.priority ?? 3} requirement still has no reusable test coverage attached.`,
      label: "Design coverage",
      tone: (requirement.priority ?? 3) <= 2 ? "error" as const : "info" as const,
      to: "/requirements"
    }));

    const automationItems = casesWithoutSteps.slice(0, 2).map((testCase) => ({
      id: `case-${testCase.id}`,
      title: testCase.title,
      detail: "Reusable case exists, but it still needs executable steps before it becomes automation-ready.",
      label: "Add steps",
      tone: "info" as const,
      to: "/test-cases"
    }));

    return [...failedExecutions, ...requirementItems, ...automationItems].slice(0, 6);
  }, [casesWithoutSteps, coverageGaps, recentExecutions]);

  const releaseLanes = useMemo(() => {
    return appTypesList
      .map((appType) => {
        const scopedCases = testCasesList.filter((testCase) => testCase.app_type_id === appType.id);
        const scopedSuites = suitesList.filter((suite) => suite.app_type_id === appType.id);
        const scopedResults = executionResultsList.filter((result) => result.app_type_id === appType.id);
        const executableCases = scopedCases.filter((testCase) => (caseStepCountById[testCase.id] || 0) > 0).length;
        const passedCount = scopedResults.filter((result) => result.status === "passed").length;
        const failedCount = scopedResults.filter((result) => result.status === "failed").length;
        const blockedCount = scopedResults.filter((result) => result.status === "blocked").length;
        const automationScore = scopedCases.length ? Math.round((executableCases / scopedCases.length) * 100) : 0;
        const qualityScore = scopedResults.length ? Math.round((passedCount / scopedResults.length) * 100) : 0;
        const releaseScore = Math.round((automationScore * 0.45) + (qualityScore * 0.55));
        const failedSignals = failedCount + blockedCount;

        let label = "No release signal";
        let tone: DashboardTone = "neutral";
        let destination = "/design";

        if (failedSignals) {
          label = "At risk";
          tone = "error";
          destination = "/executions";
        } else if (!scopedCases.length) {
          label = "No design yet";
          tone = "neutral";
        } else if (automationScore < 60) {
          label = "Build automation";
          tone = "info";
          destination = "/test-cases";
        } else if (qualityScore >= 80) {
          label = "Stable";
          tone = "success";
          destination = "/executions";
        } else if (qualityScore > 0) {
          label = "Needs hardening";
          tone = "info";
          destination = "/executions";
        }

        return {
          id: appType.id,
          name: appType.name,
          projectName: projectsList.find((project) => project.id === appType.project_id)?.name || "Unknown product",
          type: appType.type,
          cases: scopedCases.length,
          suites: scopedSuites.length,
          executableCases,
          failedSignals,
          releaseScore,
          qualityScore,
          automationScore,
          label,
          tone,
          destination
        };
      })
      .sort((left, right) => {
        if (left.failedSignals !== right.failedSignals) {
          return right.failedSignals - left.failedSignals;
        }

        return left.releaseScore - right.releaseScore;
      })
      .slice(0, 6);
  }, [appTypesList, caseStepCountById, executionResultsList, projectsList, suitesList, testCasesList]);

  const riskHotspots = useMemo(() => {
    const aggregated = executionResultsList
      .filter((result) => result.status === "failed" || result.status === "blocked")
      .reduce<Record<string, {
        id: string;
        title: string;
        detail: string;
        count: number;
        status: "failed" | "blocked";
        executionId: string;
      }>>((items, result) => {
        const key = result.test_case_id;
        const current = items[key];
        const detail = result.error || result.suite_name || "Execution instability needs follow-up.";

        if (!current) {
          items[key] = {
            id: key,
            title: result.test_case_title || result.test_case_id,
            detail,
            count: 1,
            status: result.status === "failed" ? "failed" : "blocked",
            executionId: result.execution_id
          };
          return items;
        }

        current.count += 1;
        current.detail = detail;
        current.status = current.status === "failed" || result.status === "failed" ? "failed" : "blocked";
        current.executionId = result.execution_id;
        return items;
      }, {});

    return Object.values(aggregated)
      .sort((left, right) => right.count - left.count || left.title.localeCompare(right.title))
      .slice(0, 6);
  }, [executionResultsList]);

  const activitySeries = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      return {
        key: `${date.getFullYear()}-${date.getMonth()}`,
        label: monthFormatter.format(date),
        total: 0
      };
    });

    executionResultsList.forEach((result) => {
      const createdAt = result.created_at ? new Date(result.created_at) : null;

      if (!createdAt || Number.isNaN(createdAt.getTime())) {
        return;
      }

      const key = `${createdAt.getFullYear()}-${createdAt.getMonth()}`;
      const month = months.find((item) => item.key === key);

      if (month) {
        month.total += 1;
      }
    });

    const peak = Math.max(...months.map((item) => item.total), 1);

    return months.map((item) => ({
      ...item,
      height: Math.max(14, Math.round((item.total / peak) * 100))
    }));
  }, [executionResultsList]);

  const hasActivityData = activitySeries.some((item) => item.total > 0);

  const funnelMetrics = useMemo(() => {
    return [
      {
        id: "requirements",
        label: "Requirements",
        value: requirementsList.length,
        detail: "Product scope tracked in QAira",
        chipLabel: "Scope",
        tone: "neutral" as const
      },
      {
        id: "covered",
        label: "Covered",
        value: mappedRequirementsCount,
        detail: `${requirementCoverage}% linked to reusable cases`,
        chipLabel: requirementCoverage >= 80 ? "Healthy" : "Growing",
        tone: requirementCoverage >= 80 ? "success" as const : "info" as const
      },
      {
        id: "suites",
        label: "Suites",
        value: suitesList.length,
        detail: "Reusable low-code flow groups",
        chipLabel: suitesList.length ? "Reusable" : "Needed",
        tone: suitesList.length ? "info" as const : "neutral" as const
      },
      {
        id: "cases",
        label: "Cases",
        value: testCasesList.length,
        detail: "Reusable quality assets available",
        chipLabel: testCasesList.length ? "Ready" : "Empty",
        tone: testCasesList.length ? "info" as const : "neutral" as const
      },
      {
        id: "executable",
        label: "Executable",
        value: casesWithStepsCount,
        detail: `${automationReadiness}% ready for execution`,
        chipLabel: automationReadiness >= 70 ? "Automation" : "Build out",
        tone: automationReadiness >= 70 ? "success" as const : "info" as const
      },
      {
        id: "evidence",
        label: "Evidence",
        value: executionResultsList.length,
        detail: "Captured execution signals",
        chipLabel: executionResultsList.length ? "Observed" : "Pending",
        tone: executionResultsList.length ? "success" as const : "neutral" as const
      }
    ];
  }, [automationReadiness, casesWithStepsCount, executionResultsList.length, mappedRequirementsCount, requirementCoverage, requirementsList.length, suitesList.length, testCasesList.length]);

  const commandSignals = useMemo(() => {
    return [
      {
        label: "Requirement coverage",
        value: requirementCoverage,
        detail: `${mappedRequirementsCount}/${requirementsList.length || 0} mapped to reusable cases`,
        tone: requirementCoverage >= 80 ? "success" as const : "info" as const
      },
      {
        label: "Automation readiness",
        value: automationReadiness,
        detail: `${casesWithStepsCount}/${testCasesList.length || 0} cases have executable steps`,
        tone: automationReadiness >= 70 ? "success" as const : "info" as const
      },
      {
        label: "Execution confidence",
        value: passRate,
        detail: `${resultStatusCounts.failed} failed · ${resultStatusCounts.blocked} blocked`,
        tone: resultStatusCounts.failed ? "danger" as const : passRate >= 80 ? "success" as const : "info" as const
      }
    ];
  }, [automationReadiness, casesWithStepsCount, mappedRequirementsCount, passRate, requirementCoverage, requirementsList.length, resultStatusCounts.blocked, resultStatusCounts.failed, testCasesList.length]);

  const topRecommendation = useMemo(() => {
    if (coverageGaps.length) {
      return `${coverageGapCount} requirement${coverageGapCount === 1 ? "" : "s"} still need reusable coverage before this dashboard becomes release-grade.`;
    }

    if (casesMissingStepsCount) {
      return `${casesMissingStepsCount} reusable case${casesMissingStepsCount === 1 ? "" : "s"} still need steps before they become executable low-code assets.`;
    }

    if (resultStatusCounts.failed || resultStatusCounts.blocked) {
      return `${resultStatusCounts.failed + resultStatusCounts.blocked} unstable execution signal${resultStatusCounts.failed + resultStatusCounts.blocked === 1 ? "" : "s"} still need triage.`;
    }

    return "No critical blockers are dominating the board. The quality conversation can move from firefighting to planning.";
  }, [casesMissingStepsCount, coverageGapCount, resultStatusCounts.blocked, resultStatusCounts.failed]);

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Dashboard"
        title={`Product quality cockpit for ${session?.user.name || "your team"}`}
        description="See coverage depth, execution quality, and release readiness in one place so the next quality decision is obvious."
        meta={[
          { label: "Projects", value: projectsList.length },
          { label: "Pass rate", value: `${passRate}%` },
          { label: "Active runs", value: executionStatusCounts.running }
        ]}
        actions={
          <>
            <button className="ghost-button" onClick={() => navigate("/projects")} type="button">
              Manage Scope
            </button>
            <button className="ghost-button" onClick={() => navigate("/design")} type="button">
              Open Suite Studio
            </button>
            <button className="primary-button" onClick={() => navigate("/executions")} type="button">
              Open Execution Hub
            </button>
          </>
        }
      />

      <div className="dashboard-hero-grid">
        <Panel
          className="dashboard-command-panel"
          title="Release readiness command center"
          subtitle="What a product owner needs to know right now across coverage, automation depth, and release evidence."
        >
          <div className="dashboard-command-shell">
            <div className="dashboard-command-copy">
              <p className="dashboard-command-summary">{readinessNarrative}</p>
              <div className="dashboard-chip-row">
                <DashboardToneChip label={readinessLabel} tone={readinessTone} />
                <span className="dashboard-context-chip">{executionStatusCounts.running} active release check{executionStatusCounts.running === 1 ? "" : "s"}</span>
                <span className="dashboard-context-chip">{coverageGapCount} coverage gap{coverageGapCount === 1 ? "" : "s"}</span>
              </div>
            </div>

            <div className="dashboard-score-ring" style={readinessRingStyle}>
              <div className="dashboard-score-core">
                <span>Readiness</span>
                <strong>{releaseReadinessScore}%</strong>
                <small>release score</small>
              </div>
            </div>
          </div>

          <div className="dashboard-signal-list">
            {commandSignals.map((signal) => (
              <div className="dashboard-signal-card" key={signal.label}>
                <ProgressMeter detail={signal.detail} label={signal.label} tone={signal.tone} value={signal.value} />
              </div>
            ))}
          </div>

          <div className="detail-summary dashboard-command-footer">
            <strong>Top recommendation</strong>
            <span>{topRecommendation}</span>
          </div>
        </Panel>

        <Panel
          className="dashboard-action-panel"
          title="Next best actions"
          subtitle="Jump straight into the product and quality workflows that move release confidence fastest."
        >
          <div className="dashboard-action-grid">
            {quickActions.map((action) => (
              <button
                className="dashboard-action-card"
                key={action.id}
                onClick={() => navigate(action.to)}
                type="button"
              >
                <div className="dashboard-action-copy">
                  <span className="dashboard-action-meta">{action.meta}</span>
                  <strong>{action.title}</strong>
                  <span>{action.detail}</span>
                </div>
                <div className="dashboard-action-footer">
                  <DashboardToneChip label="Open" tone={action.tone} />
                  <span className="dashboard-action-link">Go</span>
                </div>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div className="stats-grid">
        <StatCard label="Products" value={projectsList.length} hint="Active product lines in the workspace" />
        <StatCard label="Release Surfaces" value={appTypesList.length} hint="Web, API, mobile, and unified delivery lanes" />
        <StatCard label="Reusable Suites" value={suitesList.length} hint="Low-code suite structures ready for reuse" />
        <StatCard label="Reusable Cases" value={compactNumberFormatter.format(testCasesList.length)} hint="Reusable quality assets available for delivery" />
        <StatCard label="Executable Cases" value={`${casesWithStepsCount}/${testCasesList.length || 0}`} hint="Cases already shaped for step-based execution" />
        <StatCard label="Release Checks" value={executionsList.length} hint="Execution runs captured for product evidence" />
      </div>

      <div className="two-column-grid">
        <Panel title="Release lanes" subtitle="Each delivery surface combines design depth, executable readiness, and run quality in one lane.">
          <div className="stack-list">
            {releaseLanes.map((lane) => (
              <button
                className="stack-item stack-item-button dashboard-lane-card"
                key={lane.id}
                onClick={() => navigate(lane.destination)}
                type="button"
              >
                <div className="dashboard-lane-copy">
                  <strong>{lane.name}</strong>
                  <span>{lane.projectName} · {lane.type.toUpperCase()} surface</span>
                  <div className="tile-card-metrics">
                    <span className="tile-metric">{lane.cases} cases</span>
                    <span className="tile-metric">{lane.suites} suites</span>
                    <span className="tile-metric">{lane.executableCases} executable</span>
                  </div>
                  <ProgressMeter
                    detail={`${lane.automationScore}% automation depth · ${lane.failedSignals} unstable signal${lane.failedSignals === 1 ? "" : "s"}`}
                    value={lane.releaseScore}
                  />
                </div>
                <DashboardToneChip label={lane.label} tone={lane.tone} />
              </button>
            ))}
            {!releaseLanes.length ? <div className="empty-state compact">Create an app surface first to start tracking release lanes.</div> : null}
          </div>
        </Panel>

        <Panel title="Attention queue" subtitle="The shortest path to better release confidence, prioritized for a product owner and quality lead.">
          <div className="stack-list">
            {attentionQueue.map((item) => (
              <button
                className="stack-item stack-item-button dashboard-priority-row"
                key={item.id}
                onClick={() => navigate(item.to)}
                type="button"
              >
                <div className="dashboard-priority-copy">
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
                <DashboardToneChip label={item.label} tone={item.tone} />
              </button>
            ))}
            {!attentionQueue.length ? <div className="empty-state compact">No urgent work is crowding the board right now.</div> : null}
          </div>
        </Panel>
      </div>

      <div className="two-column-grid">
        <Panel title="Automation funnel" subtitle="Track how product scope turns into reusable low-code assets and execution evidence.">
          <div className="dashboard-funnel-grid">
            {funnelMetrics.map((metric) => (
              <div className="dashboard-funnel-card" key={metric.id}>
                <span className="dashboard-funnel-label">{metric.label}</span>
                <strong>{compactNumberFormatter.format(metric.value)}</strong>
                <small>{metric.detail}</small>
                <DashboardToneChip label={metric.chipLabel} tone={metric.tone} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Execution momentum" subtitle="Run evidence over time, plus the current operating posture for release checks.">
          {hasActivityData ? (
            <div className="dashboard-momentum-shell">
              <div className="activity-chart">
                {activitySeries.map((item) => (
                  <div className="activity-bar-group" key={item.key}>
                    <div className="activity-bar-track">
                      <div className="activity-bar-fill" style={{ height: `${item.height}%` }} />
                    </div>
                    <strong>{compactNumberFormatter.format(item.total)}</strong>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>

              <div className="dashboard-momentum-summary">
                <div className="mini-card">
                  <strong>{resultStatusCounts.passed}</strong>
                  <span>Passed result signals</span>
                </div>
                <div className="mini-card">
                  <strong>{resultStatusCounts.failed + resultStatusCounts.blocked}</strong>
                  <span>Unstable result signals</span>
                </div>
                <div className="mini-card">
                  <strong>{executionStatusCounts.running}</strong>
                  <span>Active release checks</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state compact">Run the first execution to start building release momentum on the dashboard.</div>
          )}
        </Panel>
      </div>

      <div className="two-column-grid">
        <Panel title="Risk hotspots" subtitle="The reusable cases creating the loudest risk signal across recent executions.">
          <div className="stack-list">
            {riskHotspots.map((hotspot) => (
              <button
                className="stack-item stack-item-button dashboard-hotspot-row"
                key={hotspot.id}
                onClick={() => navigate(`/executions?execution=${hotspot.executionId}`)}
                type="button"
              >
                <div className="dashboard-hotspot-copy">
                  <strong>{hotspot.title}</strong>
                  <span>{hotspot.detail}</span>
                </div>
                <div className="dashboard-hotspot-meta">
                  <span className="count-pill">{hotspot.count} signal{hotspot.count === 1 ? "" : "s"}</span>
                  <StatusBadge value={hotspot.status} />
                </div>
              </button>
            ))}
            {!riskHotspots.length ? <div className="empty-state compact">No unstable hotspots are dominating recent execution evidence.</div> : null}
          </div>
        </Panel>

        <Panel title="Recent release checks" subtitle="Latest execution snapshots with a quick read on pass rate, failures, and drill-down status.">
          <div className="stack-list">
            {recentExecutions.map((execution) => (
              <button
                className="stack-item stack-item-button dashboard-run-row"
                key={execution.id}
                onClick={() => navigate(`/executions?execution=${execution.id}`)}
                type="button"
              >
                <div className="dashboard-run-copy">
                  <strong>{execution.name || "Unnamed execution"}</strong>
                  <span>{execution.projectName} · {execution.appTypeName} · {(execution.trigger || "manual").toUpperCase()}</span>
                  <ProgressMeter
                    detail={`${execution.summary.passed} passed · ${execution.summary.failed} failed · ${execution.summary.blocked} blocked`}
                    segments={buildExecutionSegments(
                      execution.summary.passed,
                      execution.summary.failed,
                      execution.summary.blocked,
                      execution.summary.total
                    )}
                    value={execution.summary.percent}
                  />
                </div>
                <StatusBadge value={execution.status} />
              </button>
            ))}
            {!recentExecutions.length ? <div className="empty-state compact">No release checks captured yet. Start an execution to create the first signal.</div> : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}
