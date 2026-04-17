import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Requirement, TestCase, TestSuite } from "../types";
import { StatusBadge } from "./StatusBadge";

export function LinkedTestCaseModal({
  appTypeName,
  projectName,
  requirements,
  suites,
  testCase,
  onClose
}: {
  appTypeName: string;
  projectName: string;
  requirements: Requirement[];
  suites: TestSuite[];
  testCase: TestCase;
  onClose: () => void;
}) {
  const [expandedSections, setExpandedSections] = useState({
    details: true,
    steps: true,
    history: false
  });
  const stepsQuery = useQuery({
    queryKey: ["linked-test-case-modal-steps", testCase.id],
    queryFn: () => api.testSteps.list({ test_case_id: testCase.id }),
    enabled: Boolean(testCase.id)
  });
  const historyQuery = useQuery({
    queryKey: ["linked-test-case-modal-history", testCase.id, testCase.app_type_id || ""],
    queryFn: () => api.executionResults.list({ test_case_id: testCase.id, app_type_id: testCase.app_type_id || undefined }),
    enabled: Boolean(testCase.id)
  });

  const linkedRequirementTitles = useMemo(
    () =>
      requirements
        .filter((requirement) => (testCase.requirement_ids || [testCase.requirement_id]).filter(Boolean).includes(requirement.id))
        .map((requirement) => requirement.title),
    [requirements, testCase.requirement_id, testCase.requirement_ids]
  );
  const linkedSuiteTitles = useMemo(
    () =>
      suites
        .filter((suite) => (testCase.suite_ids || [testCase.suite_id]).filter(Boolean).includes(suite.id))
        .map((suite) => suite.name),
    [suites, testCase.suite_id, testCase.suite_ids]
  );
  const steps = stepsQuery.data || [];
  const history = historyQuery.data || [];

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-labelledby="linked-test-case-modal-title"
        aria-modal="true"
        className="modal-card suite-test-case-editor-modal linked-test-case-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="suite-test-case-editor-header">
          <div className="suite-test-case-editor-title">
            <p className="eyebrow">Test Cases</p>
            <h3 id="linked-test-case-modal-title">{testCase.title}</h3>
            <p>Review the linked reusable case without leaving your current workflow.</p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">Close</button>
        </div>

        <div className="suite-test-case-editor-body">
          <div className="detail-summary">
            <strong>{testCase.title}</strong>
            <span>{projectName || "No project"} · {appTypeName || "No app type"}</span>
            <span>{testCase.description || "No description available."}</span>
          </div>

          <div className="metric-strip compact">
            <div className="mini-card">
              <strong>{steps.length}</strong>
              <span>Steps</span>
            </div>
            <div className="mini-card">
              <strong>{linkedSuiteTitles.length}</strong>
              <span>Linked suites</span>
            </div>
            <div className="mini-card">
              <strong>{linkedRequirementTitles.length}</strong>
              <span>Requirements</span>
            </div>
            <div className="mini-card">
              <strong>{history.length}</strong>
              <span>Test runs</span>
            </div>
          </div>

          <div className="editor-accordion">
            <LinkedTestCaseSection
              countLabel={testCase.status || "active"}
              isExpanded={expandedSections.details}
              onToggle={() => setExpandedSections((current) => ({ ...current, details: !current.details }))}
              summary="Linked context and reusable case details."
              title="Case details"
            >
              <div className="stack-list">
                <div className="stack-item">
                  <div>
                    <strong>Status</strong>
                    <span>{testCase.status || "active"}</span>
                  </div>
                  <StatusBadge value={testCase.status || "active"} />
                </div>
                <div className="stack-item">
                  <div>
                    <strong>Priority</strong>
                    <span>{`P${testCase.priority ?? 3}`}</span>
                  </div>
                </div>
                <div className="stack-item">
                  <div>
                    <strong>Linked suites</strong>
                    <span>{linkedSuiteTitles.length ? linkedSuiteTitles.join(" · ") : "Not linked to a suite."}</span>
                  </div>
                </div>
                <div className="stack-item">
                  <div>
                    <strong>Requirements</strong>
                    <span>{linkedRequirementTitles.length ? linkedRequirementTitles.join(" · ") : "No linked requirement."}</span>
                  </div>
                </div>
              </div>
            </LinkedTestCaseSection>

            <LinkedTestCaseSection
              countLabel={`${steps.length} step${steps.length === 1 ? "" : "s"}`}
              isExpanded={expandedSections.steps}
              onToggle={() => setExpandedSections((current) => ({ ...current, steps: !current.steps }))}
              summary="Reusable execution steps attached to this case."
              title="Steps"
            >
              <div className="stack-list">
                {stepsQuery.isLoading ? <div className="empty-state compact">Loading steps…</div> : null}
                {!stepsQuery.isLoading && steps.map((step) => (
                  <div className="stack-item" key={step.id}>
                    <div>
                      <strong>{`Step ${step.step_order}`}</strong>
                      <span>{step.action || "No action"}</span>
                      <span>{step.expected_result || "No expected result"}</span>
                    </div>
                  </div>
                ))}
                {!stepsQuery.isLoading && !steps.length ? <div className="empty-state compact">No steps are attached to this case.</div> : null}
              </div>
            </LinkedTestCaseSection>

            <LinkedTestCaseSection
              countLabel={`${history.length} run${history.length === 1 ? "" : "s"}`}
              isExpanded={expandedSections.history}
              onToggle={() => setExpandedSections((current) => ({ ...current, history: !current.history }))}
              summary="Recent recorded execution results for this linked case."
              title="Test runs"
            >
              <div className="stack-list">
                {historyQuery.isLoading ? <div className="empty-state compact">Loading test runs…</div> : null}
                {!historyQuery.isLoading && history.map((result) => (
                  <div className="stack-item" key={result.id}>
                    <div>
                      <strong>{result.created_at || "Recent run"}</strong>
                      <span>{result.error || result.logs || "Execution evidence recorded for this case."}</span>
                    </div>
                    <StatusBadge value={result.status} />
                  </div>
                ))}
                {!historyQuery.isLoading && !history.length ? <div className="empty-state compact">No test runs recorded for this case yet.</div> : null}
              </div>
            </LinkedTestCaseSection>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkedTestCaseSection({
  title,
  summary,
  countLabel,
  isExpanded,
  onToggle,
  children
}: {
  title: string;
  summary: string;
  countLabel: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={isExpanded ? "editor-accordion-section is-expanded" : "editor-accordion-section"}>
      <button aria-expanded={isExpanded} className="editor-accordion-toggle" onClick={onToggle} type="button">
        <div className="editor-accordion-toggle-main">
          <span aria-hidden="true" className={isExpanded ? "editor-accordion-icon is-expanded" : "editor-accordion-icon"}>
            <LinkedTestCaseChevronIcon />
          </span>
          <div className="editor-accordion-toggle-copy">
            <strong>{title}</strong>
            <span>{summary}</span>
          </div>
        </div>
        <div className="editor-accordion-toggle-meta">
          <span className="editor-accordion-toggle-count">{countLabel}</span>
          <span className="editor-accordion-toggle-state">{isExpanded ? "Collapse" : "Expand"}</span>
        </div>
      </button>
      {isExpanded ? <div className="editor-accordion-body">{children}</div> : null}
    </section>
  );
}

function LinkedTestCaseChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
