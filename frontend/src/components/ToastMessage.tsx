import { useEffect } from "react";

export function ToastMessage({
  message,
  tone = "success",
  onDismiss
}: {
  message: string;
  tone?: "success" | "error" | "info";
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) {
      return undefined;
    }

    const timer = window.setTimeout(onDismiss, tone === "error" ? 6000 : 4200);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss, tone]);

  if (!message) {
    return null;
  }

  return (
    <div
      aria-atomic="true"
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`toast-message is-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <p>{message}</p>
      <button aria-label="Dismiss message" className="toast-dismiss" onClick={onDismiss} type="button">
        Dismiss
      </button>
    </div>
  );
}
