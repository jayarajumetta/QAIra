import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  actions
}: {
  eyebrow: string;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header card">
      <div className="page-header-text">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="page-header-title">{title}</h2>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
