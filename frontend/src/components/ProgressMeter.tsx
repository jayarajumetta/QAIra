export function ProgressMeter({
  value,
  label,
  detail
}: {
  value: number;
  label?: string;
  detail?: string;
}) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div className="progress-meter" aria-label={label || `${safeValue}%`}>
      <div className="progress-meter-track">
        <div className="progress-meter-fill" style={{ width: `${safeValue}%` }} />
      </div>
      <div className="progress-meter-copy">
        <strong>{safeValue}%</strong>
        {label ? <span>{label}</span> : null}
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}
