import type { AppType, Project } from "../types";

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
      <label className="context-field">
        <span>{projectLabel}</span>
        <select value={projectId} onChange={(event) => onProjectChange(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </label>

      <label className="context-field">
        <span>{appTypeLabel}</span>
        <select disabled={!projectId} value={appTypeId} onChange={(event) => onAppTypeChange(event.target.value)}>
          {appTypes.length ? null : <option value="">No app types</option>}
          {appTypes.map((appType) => (
            <option key={appType.id} value={appType.id}>{appType.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
