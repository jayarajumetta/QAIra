import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const POPOVER_VIEWPORT_PADDING = 12;
const POPOVER_TRIGGER_GAP = 10;

export function CatalogSearchFilter({
  value,
  onChange,
  placeholder,
  ariaLabel,
  type = "text",
  activeFilterCount = 0,
  title = "Filters",
  subtitle,
  children
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  type?: "text" | "search";
  activeFilterCount?: number;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputId = useId();
  const popoverId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setIsOpen(false);
      buttonRef.current?.focus();
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverStyle({});
      return;
    }

    const updatePopoverPosition = () => {
      const button = buttonRef.current;
      const popover = popoverRef.current;

      if (!button || !popover) {
        return;
      }

      const triggerRect = button.getBoundingClientRect();
      const popoverWidth = popover.offsetWidth;
      const popoverHeight = popover.offsetHeight;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - triggerRect.bottom - POPOVER_TRIGGER_GAP - POPOVER_VIEWPORT_PADDING;
      const spaceAbove = triggerRect.top - POPOVER_TRIGGER_GAP - POPOVER_VIEWPORT_PADDING;
      const shouldOpenAbove = spaceBelow < Math.min(popoverHeight, 260) && spaceAbove > spaceBelow;
      const viewportMaxHeight = Math.max(120, viewportHeight - POPOVER_VIEWPORT_PADDING * 2);
      const availableHeight = shouldOpenAbove ? spaceAbove : spaceBelow;
      const maxHeight = Math.min(viewportMaxHeight, Math.max(120, Math.floor(availableHeight || viewportMaxHeight)));
      const left = Math.min(
        Math.max(POPOVER_VIEWPORT_PADDING, triggerRect.right - popoverWidth),
        Math.max(POPOVER_VIEWPORT_PADDING, viewportWidth - popoverWidth - POPOVER_VIEWPORT_PADDING)
      );
      const top = shouldOpenAbove
        ? Math.max(POPOVER_VIEWPORT_PADDING, triggerRect.top - POPOVER_TRIGGER_GAP - Math.min(popoverHeight, maxHeight))
        : Math.min(triggerRect.bottom + POPOVER_TRIGGER_GAP, viewportHeight - POPOVER_VIEWPORT_PADDING - Math.min(popoverHeight, maxHeight));

      setPopoverStyle({
        left,
        maxHeight,
        overflowY: "auto",
        position: "fixed",
        right: "auto",
        top
      });
    };

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);

    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [isOpen]);

  return (
    <div className="catalog-search-filter">
      <div className="catalog-search-field">
        <input
          aria-label={ariaLabel || placeholder}
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type={type}
          value={value}
        />
        <button
          aria-controls={popoverId}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label={activeFilterCount ? `Open filters (${activeFilterCount} active)` : "Open filters"}
          className={activeFilterCount ? "catalog-filter-button is-active" : "catalog-filter-button"}
          onClick={() => setIsOpen((current) => !current)}
          ref={buttonRef}
          title={activeFilterCount ? `${title} (${activeFilterCount} active)` : title}
          type="button"
        >
          <CatalogFilterIcon />
          {activeFilterCount ? <span className="catalog-filter-badge">{activeFilterCount}</span> : null}
        </button>
      </div>

      {isOpen ? (
        <div
          aria-labelledby={inputId}
          className="catalog-filter-popover"
          id={popoverId}
          ref={popoverRef}
          role="dialog"
          style={popoverStyle}
        >
          <div className="catalog-filter-popover-header">
            <strong>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function CatalogFilterIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16">
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}
