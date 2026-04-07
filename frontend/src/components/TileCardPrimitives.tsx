import type { ReactNode } from "react";

export type TileCardTone = "neutral" | "info" | "success" | "warning" | "danger";

export function formatTileCardLabel(value: string | null | undefined, fallback: string) {
  const normalized = String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return fallback;
  }

  return normalized
    .split(" ")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function getTileCardTone(value: string | null | undefined): TileCardTone {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized) {
    return "neutral";
  }

  if (["failed", "error", "rejected", "critical"].some((token) => normalized.includes(token))) {
    return "danger";
  }

  if (["blocked", "abort", "hold", "warning", "stalled"].some((token) => normalized.includes(token))) {
    return "warning";
  }

  if (["passed", "completed", "complete", "done", "approved", "ready", "resolved", "success"].some((token) => normalized.includes(token))) {
    return "success";
  }

  if (["queued", "running", "active", "open", "progress", "review"].some((token) => normalized.includes(token))) {
    return "info";
  }

  return "neutral";
}

export function TileCardIconFrame({
  children,
  tone = "info",
  className = ""
}: {
  children: ReactNode;
  tone?: TileCardTone;
  className?: string;
}) {
  return <span aria-hidden="true" className={["record-card-icon", "tile-card-icon", `tone-${tone}`, className].filter(Boolean).join(" ")}>{children}</span>;
}

export function TileCardFact({
  children,
  label,
  title,
  tone = "neutral"
}: {
  children: ReactNode;
  label: string;
  title: string;
  tone?: TileCardTone;
}) {
  return (
    <span aria-label={title} className={`tile-card-fact tone-${tone}`} title={title}>
      <span aria-hidden="true" className="tile-card-fact-icon">
        {children}
      </span>
      <span className="tile-card-fact-label">{label}</span>
    </span>
  );
}

export function TileCardStatusIndicator({
  title,
  tone = "neutral",
  icon
}: {
  title: string;
  tone?: TileCardTone;
  icon?: ReactNode;
}) {
  return (
    <span aria-label={title} className={`tile-card-status tone-${tone}`} title={title}>
      {icon || <TileCardStatusToneIcon tone={tone} />}
    </span>
  );
}

function TileCardStatusToneIcon({ tone }: { tone: TileCardTone }) {
  if (tone === "success") {
    return (
      <TileCardIconShell>
        <path d="M6 12.5 10 16l8-8" />
      </TileCardIconShell>
    );
  }

  if (tone === "warning") {
    return (
      <TileCardIconShell>
        <circle cx="12" cy="12" r="8" />
        <path d="M8 12h8" />
      </TileCardIconShell>
    );
  }

  if (tone === "danger") {
    return (
      <TileCardIconShell>
        <path d="m8 8 8 8" />
        <path d="m16 8-8 8" />
      </TileCardIconShell>
    );
  }

  if (tone === "info") {
    return (
      <TileCardIconShell>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </TileCardIconShell>
    );
  }

  return (
    <TileCardIconShell>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" fill="currentColor" r="1.25" stroke="none" />
    </TileCardIconShell>
  );
}

function TileCardIconShell({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      {children}
    </svg>
  );
}

export function TileCardSuiteIcon() {
  return (
    <TileCardIconShell>
      <rect height="6" rx="1.2" width="7" x="3" y="4" />
      <rect height="6" rx="1.2" width="7" x="14" y="4" />
      <rect height="6" rx="1.2" width="7" x="8.5" y="14" />
    </TileCardIconShell>
  );
}

export function TileCardCaseIcon() {
  return (
    <TileCardIconShell>
      <rect height="14" rx="2" width="14" x="5" y="5" />
      <path d="M9 10h6" />
      <path d="M9 14h6" />
    </TileCardIconShell>
  );
}

export function TileCardRequirementIcon() {
  return (
    <TileCardIconShell>
      <path d="M8 4.5h6l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 7 19V6a1.5 1.5 0 0 1 1-1.5Z" />
      <path d="M14 4.5V9h4" />
      <path d="M10 12h5" />
      <path d="M10 16h5" />
    </TileCardIconShell>
  );
}

export function TileCardPriorityIcon() {
  return (
    <TileCardIconShell>
      <path d="M7 20V5" />
      <path d="M7 5h10l-2 4 2 4H7" />
    </TileCardIconShell>
  );
}

export function TileCardStepsIcon() {
  return (
    <TileCardIconShell>
      <path d="M8 7h10" />
      <path d="M8 12h10" />
      <path d="M8 17h10" />
      <circle cx="5" cy="7" fill="currentColor" r="1" stroke="none" />
      <circle cx="5" cy="12" fill="currentColor" r="1" stroke="none" />
      <circle cx="5" cy="17" fill="currentColor" r="1" stroke="none" />
    </TileCardIconShell>
  );
}

export function TileCardLinkIcon() {
  return (
    <TileCardIconShell>
      <path d="M10 13.5 14 9.5" />
      <path d="M8.5 16a3.5 3.5 0 0 1 0-5l2-2a3.5 3.5 0 0 1 5 5l-.5.5" />
      <path d="M15.5 8a3.5 3.5 0 0 1 0 5l-2 2a3.5 3.5 0 0 1-5-5l.5-.5" />
    </TileCardIconShell>
  );
}

export function TileCardRunsIcon() {
  return (
    <TileCardIconShell>
      <path d="M5 12a7 7 0 0 1 7-7" />
      <path d="M19 12a7 7 0 0 1-7 7" />
      <path d="m13 8 4 0 0-4" />
      <path d="m11 16-4 0 0 4" />
    </TileCardIconShell>
  );
}

export function TileCardHierarchyIcon() {
  return (
    <TileCardIconShell>
      <path d="M6 6h12" />
      <path d="M12 6v5" />
      <path d="M7 16h4" />
      <path d="M13 16h4" />
      <path d="M9 11v5" />
      <path d="M15 11v5" />
    </TileCardIconShell>
  );
}

export function TileCardProjectIcon() {
  return (
    <TileCardIconShell>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H10l2 2h6.5A2.5 2.5 0 0 1 21 10.5v8A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5z" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </TileCardIconShell>
  );
}

export function TileCardUsersIcon() {
  return (
    <TileCardIconShell>
      <path d="M16 20v-1.4a3.6 3.6 0 0 0-3.6-3.6H8.6A3.6 3.6 0 0 0 5 18.6V20" />
      <circle cx="10.5" cy="9" r="3" />
      <path d="M17 11a2.6 2.6 0 0 1 0 5" />
      <path d="M20 20v-1.1a3.2 3.2 0 0 0-2.4-3.1" />
    </TileCardIconShell>
  );
}

export function TileCardAppTypesIcon() {
  return (
    <TileCardIconShell>
      <rect height="5" rx="1.1" width="16" x="4" y="5" />
      <rect height="5" rx="1.1" width="16" x="4" y="14" />
      <path d="M8 7.5h.01" />
      <path d="M8 16.5h.01" />
      <path d="M14 7.5h4" />
      <path d="M14 16.5h4" />
    </TileCardIconShell>
  );
}
