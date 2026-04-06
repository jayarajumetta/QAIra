import type { ReactNode } from "react";

type PageHeaderMetaItem = {
  label: string;
  value: ReactNode;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className = ""
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: PageHeaderMetaItem[];
  className?: string;
}) {
  return (
    <header className={["page-header", "card", actions ? "" : "page-header--no-actions", className].filter(Boolean).join(" ")}>
      <div className="page-header-text">
        <div className="page-header-copy">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="page-header-title">{title}</h1>
          {description ? <p className="page-description">{description}</p> : null}
        </div>
        {meta?.length ? (
          <div className="page-header-meta">
            {meta.map((item) => (
              <div className="page-header-meta-item" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
