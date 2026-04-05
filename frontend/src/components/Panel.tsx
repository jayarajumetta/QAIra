import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  actions,
  className = "",
  children
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel card ${className}`.trim()}>
      <div className="panel-head">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="panel-head-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
