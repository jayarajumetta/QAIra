import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ToastMessage } from "../components/ToastMessage";

const THEME_KEY = "app_theme";
const SIDEBAR_KEY = "sidebar_collapsed";
const AUTO_EXPORT_KEY = "app_auto_export";
const PREFERENCES_UPDATED_EVENT = "qaira:preferences-updated";

export function SettingsPage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarMode, setSidebarMode] = useState<"expanded" | "collapsed">("expanded");
  const [autoExport, setAutoExport] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_KEY);
    setTheme(storedTheme === "dark" ? "dark" : "light");
    setSidebarMode(window.localStorage.getItem(SIDEBAR_KEY) === "true" ? "collapsed" : "expanded");
    setAutoExport(window.localStorage.getItem(AUTO_EXPORT_KEY) === "true");
  }, []);

  const saveSettings = () => {
    window.localStorage.setItem(THEME_KEY, theme);
    window.localStorage.setItem(SIDEBAR_KEY, String(sidebarMode === "collapsed"));
    window.localStorage.setItem(AUTO_EXPORT_KEY, String(autoExport));
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.sidebar = sidebarMode;
    window.dispatchEvent(
      new CustomEvent(PREFERENCES_UPDATED_EVENT, {
        detail: {
          theme,
          sidebarMode
        }
      })
    );
    setMessage("Workspace preferences saved.");
  };

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Settings"
        title="Workspace Settings"
        description="Save the interface defaults and behavior preferences you want to carry across sessions."
        meta={[
          { label: "Theme", value: theme === "light" ? "Light" : "Dark" },
          { label: "Sidebar", value: sidebarMode === "collapsed" ? "Collapsed" : "Expanded" },
          { label: "Export prompts", value: autoExport ? "Enabled" : "Off" }
        ]}
        actions={<button className="primary-button" onClick={saveSettings} type="button">Save preferences</button>}
      />

      <ToastMessage message={message} onDismiss={() => setMessage("")} />

      <div className="two-column-grid">
        <Panel title="Appearance" subtitle="Keep the interface comfortable for long QA sessions.">
          <div className="detail-stack">
            <label className="checkbox-field">
              <input checked={theme === "light"} onChange={() => setTheme("light")} type="radio" />
              <span>Light theme</span>
            </label>
            <label className="checkbox-field">
              <input checked={theme === "dark"} onChange={() => setTheme("dark")} type="radio" />
              <span>Dark theme</span>
            </label>
            <label className="checkbox-field">
              <input checked={sidebarMode === "expanded"} onChange={() => setSidebarMode("expanded")} type="radio" />
              <span>Expanded sidebar by default</span>
            </label>
            <label className="checkbox-field">
              <input checked={sidebarMode === "collapsed"} onChange={() => setSidebarMode("collapsed")} type="radio" />
              <span>Collapsed sidebar by default</span>
            </label>
          </div>
        </Panel>

        <Panel title="Export & retention" subtitle="Decide how much trace data should be surfaced and exported.">
          <div className="detail-stack">
            <label className="checkbox-field">
              <input checked={autoExport} onChange={(event) => setAutoExport(event.target.checked)} type="checkbox" />
              <span>Offer execution export prompts after completed runs</span>
            </label>
            <div className="detail-summary">
              <strong>Historical evidence is preserved</strong>
              <span>Deleting live suites or test cases does not remove execution snapshots already captured.</span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
