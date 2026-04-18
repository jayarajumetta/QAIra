export function DisplayIdBadge({ value }: { value: string }) {
  return (
    <div className="display-id-badge">
      <code>{value}</code>
    </div>
  );
}
