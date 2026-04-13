import type { AppType, Project } from "../types";
import { ProjectDropdown } from "./ProjectDropdown";

export function WorkspaceScopeBar({
  projects,
  projectId,
  appTypes,
  appTypeId,
  onProjectChange,
  onAppTypeChange,
  projectLabel = "Project",
  appTypeLabel = "App Type",
  disabled = false,
  projectValueLabel,
  appTypeValueLabel
}: {
  projects: Project[];
  projectId: string;
  appTypes: AppType[];
  appTypeId: string;
  onProjectChange: (value: string) => void;
  onAppTypeChange: (value: string) => void;
  projectLabel?: string;
  appTypeLabel?: string;
  disabled?: boolean;
  projectValueLabel?: string;
  appTypeValueLabel?: string;
}) {
  const resolvedProjectLabel =
    projectValueLabel || projects.find((project) => project.id === projectId)?.name || "No project selected";
  const resolvedAppTypeLabel =
    appTypeValueLabel || appTypes.find((appType) => appType.id === appTypeId)?.name || "No app type selected";

  return (
    <div className={disabled ? "design-context-bar is-sticky is-read-only" : "design-context-bar is-sticky"}>
      <div className="context-field">
        <span>{projectLabel}</span>
        {disabled ? (
          <div aria-label={`${projectLabel} snapshot`} className="context-value" role="textbox">
            {resolvedProjectLabel}
          </div>
        ) : (
          <ProjectDropdown
            ariaLabel={`Select ${projectLabel.toLowerCase()}`}
            onChange={onProjectChange}
            projects={projects}
            value={projectId}
          />
        )}
      </div>

      <label className="context-field">
        <span>{appTypeLabel}</span>
        {disabled ? (
          <div aria-label={`${appTypeLabel} snapshot`} className="context-value" role="textbox">
            {resolvedAppTypeLabel}
          </div>
        ) : (
          <select disabled={!projectId} value={appTypeId} onChange={(event) => onAppTypeChange(event.target.value)}>
            <option value="">
              {!projectId ? `Select ${projectLabel.toLowerCase()} first` : appTypes.length ? `Select ${appTypeLabel.toLowerCase()}` : "No app types available"}
            </option>
            {appTypes.map((appType) => (
              <option key={appType.id} value={appType.id}>{appType.name}</option>
            ))}
          </select>
        )}
      </label>
    </div>
  );
}
