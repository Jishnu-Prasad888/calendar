/** Centered spinner for a page whose content has not arrived yet. */
export function LoadingState({ label }: { label: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="large-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
