import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";

const notificationFeed = [
  { title: "Execution failed in Checkout Regression", detail: "2 minutes ago · Web Portal · Assigned to release team", tone: "error" },
  { title: "AI design preview completed", detail: "18 minutes ago · Requirement coverage updated", tone: "success" },
  { title: "New integration was activated", detail: "1 hour ago · OpenAI production key rotated", tone: "info" },
  { title: "Project membership changed", detail: "Today · Two new members added to Mobile QA", tone: "neutral" }
] as const;

export function NotificationsPage() {
  const [channels, setChannels] = useState({
    failures: true,
    ai: true,
    governance: false,
    digest: true
  });

  return (
    <div className="page-content">
      <PageHeader eyebrow="Notifications" title="Notification Center" />

      <div className="workspace-grid">
        <Panel title="Rules" subtitle="Decide which events should surface immediately and which should wait for a digest.">
          <div className="detail-stack">
            <label className="checkbox-field">
              <input checked={channels.failures} onChange={(event) => setChannels((current) => ({ ...current, failures: event.target.checked }))} type="checkbox" />
              <span>Execution failures and blocked runs</span>
            </label>
            <label className="checkbox-field">
              <input checked={channels.ai} onChange={(event) => setChannels((current) => ({ ...current, ai: event.target.checked }))} type="checkbox" />
              <span>AI design completions and acceptance events</span>
            </label>
            <label className="checkbox-field">
              <input checked={channels.governance} onChange={(event) => setChannels((current) => ({ ...current, governance: event.target.checked }))} type="checkbox" />
              <span>Project membership, role, and integration governance changes</span>
            </label>
            <label className="checkbox-field">
              <input checked={channels.digest} onChange={(event) => setChannels((current) => ({ ...current, digest: event.target.checked }))} type="checkbox" />
              <span>Daily digest for workspace health and coverage updates</span>
            </label>
            <button className="primary-button" type="button">Save notification preferences</button>
          </div>
        </Panel>

        <Panel title="Recent activity" subtitle="A compact activity stream for the events that matter most.">
          <div className="stack-list">
            {notificationFeed.map((item) => (
              <div className="stack-item" key={item.title}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
                <span className={`status-pill tone-${item.tone}`}>{item.tone}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
