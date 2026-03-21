import type { ReactNode } from "react";

export function FormField({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
