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
  appTypeLabel = "App Type"
}: {
  projects: Project[];
  projectId: string;
  appTypes: AppType[];
  appTypeId: string;
  onProjectChange: (value: string) => void;
  onAppTypeChange: (value: string) => void;
  projectLabel?: string;
  appTypeLabel?: string;
}) {
  return (
    <div className="design-context-bar is-sticky">
      <div className="context-field">
        <span>{projectLabel}</span>
        <ProjectDropdown
          ariaLabel={`Select ${projectLabel.toLowerCase()}`}
          onChange={onProjectChange}
          projects={projects}
          value={projectId}
        />
      </div>

      <label className="context-field">
        <span>{appTypeLabel}</span>
        <select disabled={!projectId} value={appTypeId} onChange={(event) => onAppTypeChange(event.target.value)}>
          <option value="">
            {!projectId ? `Select ${projectLabel.toLowerCase()} first` : appTypes.length ? `Select ${appTypeLabel.toLowerCase()}` : "No app types available"}
          </option>
          {appTypes.map((appType) => (
            <option key={appType.id} value={appType.id}>{appType.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
