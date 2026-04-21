import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreIcon } from "./AppIcons";

export type CatalogActionMenuItem = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  description?: string;
  disabled?: boolean;
  tone?: "default" | "danger" | "primary";
};

export function CatalogActionMenu({
  label,
  actions,
  className = ""
}: {
  label: string;
  actions: CatalogActionMenuItem[];
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className={["step-card-menu", "step-card-menu--flat", "catalog-action-menu", className].filter(Boolean).join(" ")}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        className="step-card-menu-trigger"
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((current) => !current);
        }}
        ref={triggerRef}
        title={label}
        type="button"
      >
        <MoreIcon />
      </button>
      {isOpen ? (
        <div className="step-card-menu-panel catalog-action-menu-panel" ref={menuRef} role="menu">
          {actions.map((action) => (
            <button
              className={["step-card-menu-item", action.tone ? `is-${action.tone}` : ""].filter(Boolean).join(" ")}
              disabled={action.disabled}
              key={action.label}
              onClick={(event) => {
                event.stopPropagation();
                action.onClick();
                setIsOpen(false);
              }}
              role="menuitem"
              title={action.label}
              type="button"
            >
              {action.icon}
              <span className="step-card-menu-item-content">
                <span className="step-card-menu-item-label">{action.label}</span>
                {action.description ? <span className="step-card-menu-item-description">{action.description}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
