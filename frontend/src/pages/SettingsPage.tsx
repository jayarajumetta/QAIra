import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { useLocalization } from "../context/LocalizationContext";
import { SaveIcon } from "../components/AppIcons";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ToastMessage } from "../components/ToastMessage";
import { api } from "../lib/api";
import { DEFAULT_LOCALIZATION_STRINGS } from "../lib/localization";

const THEME_KEY = "app_theme";
const SIDEBAR_KEY = "sidebar_collapsed";
const AUTO_EXPORT_KEY = "app_auto_export";
const PREFERENCES_UPDATED_EVENT = "qaira:preferences-updated";

export function SettingsPage() {
  const { session } = useAuth();
  const { strings, setWorkspaceStrings, t } = useLocalization();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarMode, setSidebarMode] = useState<"expanded" | "collapsed">("expanded");
  const [autoExport, setAutoExport] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [isSavingLocalization, setIsSavingLocalization] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isAdmin = session?.user.role === "admin";

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
    setMessageTone("success");
    setMessage("Workspace preferences saved.");
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const handleDownloadLocalization = () => {
    const blob = new Blob([JSON.stringify(strings, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "qaira-localization.json";
    link.click();
    URL.revokeObjectURL(href);
  };

  const persistLocalization = async (nextStrings: Record<string, string>, successMessage: string) => {
    setIsSavingLocalization(true);

    try {
      const response = await api.settings.updateLocalization({ strings: nextStrings });
      setWorkspaceStrings(response.strings);
      setMessageTone("success");
      setMessage(successMessage);
    } catch (error) {
      showError(error, "Unable to save localization strings.");
    } finally {
      setIsSavingLocalization(false);
    }
  };

  const handleUploadLocalization = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as Record<string, string>;

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Localization file must be a JSON object.");
      }

      await persistLocalization(parsed, "Localization strings updated.");
    } catch (error) {
      showError(error, "Unable to upload localization strings.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
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
        actions={<button className="primary-button" onClick={saveSettings} type="button"><SaveIcon />Save preferences</button>}
      />

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      <div className="two-column-grid">
        <Panel title="Appearance" subtitle="Keep the interface comfortable for long QA sessions.">
          <div className="detail-stack">
            <label className="checkbox-field">
              <input checked={theme === "light"} name="theme-preference" onChange={() => setTheme("light")} type="radio" />
              <span>Light theme</span>
            </label>
            <label className="checkbox-field">
              <input checked={theme === "dark"} name="theme-preference" onChange={() => setTheme("dark")} type="radio" />
              <span>Dark theme</span>
            </label>
            <label className="checkbox-field">
              <input checked={sidebarMode === "expanded"} name="sidebar-preference" onChange={() => setSidebarMode("expanded")} type="radio" />
              <span>Expanded sidebar by default</span>
            </label>
            <label className="checkbox-field">
              <input checked={sidebarMode === "collapsed"} name="sidebar-preference" onChange={() => setSidebarMode("collapsed")} type="radio" />
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

        <Panel
          title={t("settings.localization.title", "Localization")}
          subtitle={t("settings.localization.subtitle", "Download the current runtime strings, edit the JSON, then upload it to relabel menus and supported interface text.")}
        >
          <div className="detail-stack">
            <div className="detail-summary">
              <strong>{Object.keys(strings).length} strings ready</strong>
              <span>{t("settings.localization.helper", "Only admins can publish updated localization strings for the workspace.")}</span>
            </div>

            <div className="action-row">
              <button className="ghost-button" onClick={handleDownloadLocalization} type="button">
                {t("settings.localization.download", "Download current strings")}
              </button>
              <button
                className="ghost-button"
                disabled={!isAdmin || isSavingLocalization}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                {t("settings.localization.upload", "Upload JSON")}
              </button>
              <button
                className="ghost-button danger"
                disabled={!isAdmin || isSavingLocalization}
                onClick={() => void persistLocalization(DEFAULT_LOCALIZATION_STRINGS, "Uploaded localization reset to defaults.")}
                type="button"
              >
                {t("settings.localization.reset", "Reset uploaded strings")}
              </button>
            </div>

            <input
              accept="application/json"
              hidden
              onChange={(event) => void handleUploadLocalization(event)}
              ref={fileInputRef}
              type="file"
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}
