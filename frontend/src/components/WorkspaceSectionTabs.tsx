import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SubnavTabs } from "./SubnavTabs";
import type { WorkspaceSectionItem } from "../lib/workspaceSections";

export function WorkspaceSectionTabs({
  ariaLabel = "Workspace section navigation",
  items
}: {
  ariaLabel?: string;
  items: Array<WorkspaceSectionItem & { meta?: string }>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeItem = items.find((item) => item.to === location.pathname) || items[0];

  if (!activeItem) {
    return null;
  }

  return (
    <div className="workspace-section-tabs-shell">
      <SubnavTabs
        ariaLabel={ariaLabel}
        className="section-switch-bar"
        items={items.map((item) => ({
          value: item.to,
          label: item.label,
          meta: item.meta,
          icon: resolveWorkspaceSectionIcon(item.icon)
        }))}
        onChange={(value) => {
          if (value !== location.pathname) {
            navigate(value);
          }
        }}
        value={activeItem.to}
      />
    </div>
  );
}

function resolveWorkspaceSectionIcon(icon?: string) {
  const frame = (children: ReactNode) => (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16">
      {children}
    </svg>
  );

  switch (icon) {
    case "requirements":
      return frame(<><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M14 3v6h6" /><path d="M9 13h6" /><path d="M9 17h6" /></>);
    case "cases":
      return frame(<><path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" /><path d="M8 9h8" /><path d="M8 13h8" /><path d="M8 17h5" /></>);
    case "shared":
      return frame(<><circle cx="7" cy="8" r="2.5" /><circle cx="17" cy="8" r="2.5" /><circle cx="12" cy="17" r="2.5" /><path d="m9.2 9.4 2 5.2" /><path d="m14.8 9.4-2 5.2" /><path d="M9.5 8h5" /></>);
    case "suites":
      return frame(<><path d="m12 4 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4" /><path d="m4 16 8 4 8-4" /></>);
    case "executions":
      return frame(<><path d="m7 4 12 8-12 8z" /></>);
    case "environments":
      return frame(<><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /><path d="M8 7h.01" /><path d="M8 17h.01" /></>);
    case "data":
      return frame(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" /><path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" /></>);
    case "configurations":
      return frame(<><path d="M4 6h6" /><path d="M14 6h6" /><path d="M10 6a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" /><path d="M4 18h3" /><path d="M11 18h9" /><path d="M7 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" /></>);
    default:
      return null;
  }
}
