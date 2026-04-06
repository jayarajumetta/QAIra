export function SubnavTabs<T extends string>({
  value,
  onChange,
  items
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string; meta?: string }>;
}) {
  return (
    <div className="subnav-tabs" role="tablist" aria-label="Section navigation">
      {items.map((item) => (
        <button
          key={item.value}
          aria-selected={value === item.value}
          className={value === item.value ? "subnav-tab is-active" : "subnav-tab"}
          onClick={() => onChange(item.value)}
          role="tab"
          tabIndex={value === item.value ? 0 : -1}
          type="button"
        >
          <strong>{item.label}</strong>
          {item.meta ? <span>{item.meta}</span> : null}
        </button>
      ))}
    </div>
  );
}
