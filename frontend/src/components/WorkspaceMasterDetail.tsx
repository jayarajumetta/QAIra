import type { ReactNode } from "react";

export function WorkspaceMasterDetail({
  browseView,
  className = "",
  detailView,
  isDetailOpen
}: {
  browseView: ReactNode;
  className?: string;
  detailView: ReactNode;
  isDetailOpen: boolean;
}) {
  return (
    <div className={["workspace-master-detail", isDetailOpen ? "is-detail-open" : "is-browse-open", className].filter(Boolean).join(" ")}>
      <div className="workspace-master-detail-panel">
        {isDetailOpen ? detailView : browseView}
      </div>
    </div>
  );
}

export function WorkspaceBackButton({
  label,
  onClick
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="ghost-button workspace-back-button" onClick={onClick} type="button">
      <WorkspaceBackIcon />
      <span>{label}</span>
    </button>
  );
}

function WorkspaceBackIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <path d="m15 18-6-6 6-6" />
      <path d="M9 12h10" />
    </svg>
  );
}
