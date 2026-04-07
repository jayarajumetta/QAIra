import { useEffect, useRef } from "react";

const FALLBACK_FOCUSABLE_SELECTOR = [
  "input:not([type='hidden']):not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

export function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;

    if (!dialog) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const preferredTarget = dialog.querySelector<HTMLElement>("[data-autofocus='true']");
      const fallbackTarget = dialog.querySelector<HTMLElement>(FALLBACK_FOCUSABLE_SELECTOR);

      (preferredTarget || fallbackTarget || dialog).focus();
    });

    return () => {
      window.cancelAnimationFrame(frameId);

      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, []);

  return ref;
}
