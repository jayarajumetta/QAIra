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
          meta: item.meta
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
