import type { ReactNode } from "react";

type IconProps = {
  size?: number;
  strokeWidth?: number;
};

function IconFrame({
  children,
  size = 16,
  strokeWidth = 1.9
}: {
  children: ReactNode;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

export function AddIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconFrame>
  );
}

export function SaveIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v6h8V4" />
      <path d="M9 20v-6h6v6" />
    </IconFrame>
  );
}

export function UploadIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 20h14" />
    </IconFrame>
  );
}

export function ImportIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </IconFrame>
  );
}

export function SparkIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="m12 3 1.9 4.9L19 10l-5.1 2.1L12 17l-1.9-4.9L5 10l5.1-2.1L12 3Z" />
    </IconFrame>
  );
}

export function FolderIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
    </IconFrame>
  );
}

export function UsersIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M16 20a4 4 0 0 0-8 0" />
      <circle cx="12" cy="11" r="3" />
      <path d="M20 20a3.5 3.5 0 0 0-3-3.4" />
      <path d="M7 16.6A3.5 3.5 0 0 0 4 20" />
    </IconFrame>
  );
}

export function PlugIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M9 3v6" />
      <path d="M15 3v6" />
      <path d="M7 9h10v2a5 5 0 0 1-5 5 5 5 0 0 1-5-5z" />
      <path d="M12 16v5" />
    </IconFrame>
  );
}

export function MailIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <rect height="14" rx="2" width="18" x="3" y="5" />
      <path d="m4 7 8 6 8-6" />
    </IconFrame>
  );
}

export function MessageIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H11l-4 4v-4H7.5A2.5 2.5 0 0 1 5 12.5z" />
    </IconFrame>
  );
}

export function PlayIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="m8 6 10 6-10 6z" />
    </IconFrame>
  );
}

export function CalendarIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <rect height="15" rx="2" width="18" x="3" y="5" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M3 10h18" />
    </IconFrame>
  );
}

export function LayersIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="m12 4 8 4-8 4-8-4z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </IconFrame>
  );
}

export function GridIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <rect height="6" rx="1.25" width="6" x="4" y="4" />
      <rect height="6" rx="1.25" width="6" x="14" y="4" />
      <rect height="6" rx="1.25" width="6" x="4" y="14" />
      <rect height="6" rx="1.25" width="6" x="14" y="14" />
    </IconFrame>
  );
}

export function ListIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M9 7h10" />
      <path d="M9 12h10" />
      <path d="M9 17h10" />
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}
