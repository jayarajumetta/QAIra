import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import type { Project } from "../types";

type ProjectDropdownProps = {
  projects: Project[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  emptyLabel?: string;
  disabled?: boolean;
};

type MenuPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

const VIEWPORT_PADDING = 12;
const MENU_OFFSET = 8;

export function ProjectDropdown({
  projects,
  value,
  onChange,
  ariaLabel,
  emptyLabel = "No projects available",
  disabled = false
}: ProjectDropdownProps) {
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === value) || projects[0] || null,
    [projects, value]
  );

  const updateMenuPosition = () => {
    if (!triggerRef.current || typeof window === "undefined") {
      return;
    }

    const triggerBounds = triggerRef.current.getBoundingClientRect();
    const width = Math.min(triggerBounds.width, window.innerWidth - VIEWPORT_PADDING * 2);
    const left = Math.min(
      Math.max(triggerBounds.left, VIEWPORT_PADDING),
      window.innerWidth - width - VIEWPORT_PADDING
    );
    const top = triggerBounds.bottom + MENU_OFFSET;
    const maxHeight = Math.max(168, window.innerHeight - top - VIEWPORT_PADDING);

    setMenuPosition({
      top,
      left,
      width,
      maxHeight
    });
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    updateMenuPosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleViewportChange = () => updateMenuPosition();

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!projects.length || disabled) {
      setIsOpen(false);
    }
  }, [disabled, projects.length]);

  const menuStyle: CSSProperties | undefined = menuPosition
    ? {
        top: `${menuPosition.top}px`,
        left: `${menuPosition.left}px`,
        width: `${menuPosition.width}px`,
        maxHeight: `${menuPosition.maxHeight}px`
      }
    : undefined;

  return (
    <div className="project-dropdown">
      <button
        ref={triggerRef}
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="project-dropdown-trigger"
        disabled={disabled || !projects.length}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="project-dropdown-value">{selectedProject?.name || emptyLabel}</span>
        <span aria-hidden="true" className={isOpen ? "project-dropdown-icon is-open" : "project-dropdown-icon"}>
          <ProjectDropdownChevronIcon />
        </span>
      </button>

      {isOpen && menuStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              aria-label={ariaLabel}
              className="project-dropdown-menu"
              id={listboxId}
              role="listbox"
              style={menuStyle}
            >
              {projects.map((project) => {
                const isSelected = project.id === selectedProject?.id;

                return (
                  <button
                    aria-selected={isSelected}
                    className={isSelected ? "project-dropdown-option is-selected" : "project-dropdown-option"}
                    key={project.id}
                    onClick={() => {
                      onChange(project.id);
                      setIsOpen(false);
                    }}
                    role="option"
                    type="button"
                  >
                    <span>{project.name}</span>
                    {isSelected ? <strong>Current</strong> : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function ProjectDropdownChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
