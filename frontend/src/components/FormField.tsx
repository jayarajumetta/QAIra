import type { ReactNode } from "react";

export function FormField({
  label,
  children,
  error
}: {
  label: string;
  children: ReactNode;
  error?: string;
}) {
  const id = `field-${label.toLowerCase().replace(/\s+/g, "-")}`;
  
  return (
    <label className="form-field" htmlFor={id}>
      <span>{label}</span>
      {children}
      {error && <span className="form-field-error" id={`${id}-error`} role="alert">{error}</span>}
    </label>
  );
}
