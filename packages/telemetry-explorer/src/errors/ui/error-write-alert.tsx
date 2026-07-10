// Inline failure line under a triage write control (composer, delete, status
// change). Server-sanitized messages are shown as-is; anything else falls
// back to the caller's generic message.
export function ErrorWriteAlert({
  error,
  fallback,
}: {
  error: unknown;
  fallback: string;
}) {
  return (
    <p role="alert" className="text-xs text-destructive">
      {error instanceof Error ? error.message : fallback}
    </p>
  );
}
