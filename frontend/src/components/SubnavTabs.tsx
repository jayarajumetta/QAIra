import { useRef, type KeyboardEvent, type ReactNode } from "react";

export function SubnavTabs<T extends string>({
  value,
  onChange,
  items,
  ariaLabel = "Section navigation",
  className = ""
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string; meta?: string; icon?: ReactNode }>;
  ariaLabel?: string;
  className?: string;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!items.length) {
      return;
    }

    let nextIndex = index;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % items.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + items.length) % items.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    onChange(items[nextIndex].value);
    window.requestAnimationFrame(() => {
      tabRefs.current[nextIndex]?.focus();
    });
  };

  return (
    <div className={["subnav-tabs", className].filter(Boolean).join(" ")} role="tablist" aria-label={ariaLabel}>
      {items.map((item, index) => (
        <button
          key={item.value}
          aria-selected={value === item.value}
          className={value === item.value ? "subnav-tab is-active" : "subnav-tab"}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          ref={(node) => {
            tabRefs.current[index] = node;
          }}
          role="tab"
          tabIndex={value === item.value ? 0 : -1}
          type="button"
        >
          {item.icon ? <span aria-hidden="true" className="subnav-tab-icon">{item.icon}</span> : null}
          <span className="subnav-tab-copy">
            <strong>{item.label}</strong>
            {item.meta ? <span>{item.meta}</span> : null}
          </span>
          <span aria-hidden="true" className="subnav-tab-indicator" />
        </button>
      ))}
    </div>
  );
}
