import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";

const supportChannels = [
  {
    title: "Platform support",
    description: "Reach the internal QAira workspace team for environment issues, access recovery, and platform defects.",
    value: "support@qaira.local"
  },
  {
    title: "Release escalation",
    description: "Use this channel when active execution blockers are affecting a release milestone or go-live decision.",
    value: "release-ops@qaira.local"
  },
  {
    title: "Integration help",
    description: "Contact the integration desk for LLM keys, Jira connectivity, or webhook troubleshooting.",
    value: "integrations@qaira.local"
  }
];

const playbooks = [
  "Workspace access and onboarding",
  "Project setup checklist",
  "Requirement to test-case design flow",
  "Execution incident triage guide",
  "Integrations and API key rotation"
];

export function SupportPage() {
  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Support"
        title="Support Center"
        description="A calm place to find operating guidance, escalation paths, and contact channels for the QA workspace."
        actions={<button className="primary-button" type="button">Open Support Ticket</button>}
      />

      <div className="two-column-grid">
        <Panel title="Support channels" subtitle="Choose the fastest path based on the kind of issue you are facing.">
          <div className="stack-list">
            {supportChannels.map((channel) => (
              <div className="stack-item" key={channel.title}>
                <div>
                  <strong>{channel.title}</strong>
                  <span>{channel.description}</span>
                </div>
                <span className="count-pill">{channel.value}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Service status" subtitle="Quick operating posture for the main workspace surfaces.">
          <div className="stack-list">
            <div className="stack-item">
              <div>
                <strong>Authoring services</strong>
                <span>Requirements, suites, and reusable test-case workflows are operating normally.</span>
              </div>
              <span className="status-badge completed">Healthy</span>
            </div>
            <div className="stack-item">
              <div>
                <strong>Execution services</strong>
                <span>Manual execution, result capture, and historical snapshots are available.</span>
              </div>
              <span className="status-badge running">Monitoring</span>
            </div>
            <div className="stack-item">
              <div>
                <strong>Integrations</strong>
                <span>LLM and Jira connectivity should be reviewed when API keys or endpoint policies change.</span>
              </div>
              <span className="status-badge queued">Review</span>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Playbooks" subtitle="Recommended internal guidance for common workspace operations.">
        <div className="catalog-grid compact">
          {playbooks.map((playbook) => (
            <article className="catalog-card" key={playbook}>
              <strong>{playbook}</strong>
              <p>Open the operational checklist, ownership guidance, and recommended escalation path.</p>
              <button className="ghost-button" type="button">Open guide</button>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
