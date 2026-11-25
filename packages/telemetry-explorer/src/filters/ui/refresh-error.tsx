import { Button } from "@everr/ui/components/button";

/**
 * A refresh that failed over a list still showing its loaded rows. It sits
 * above the rows instead of replacing them, so the list keeps its scroll
 * position.
 */
export function RefreshError({
  noun,
  error,
  onRetry,
}: {
  /** Plural, lower case: "traces". */
  noun: string;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="bg-destructive/10 text-destructive flex items-center gap-2 border-b px-3 py-1.5 text-xs"
    >
      <span className="min-w-0 flex-1 truncate" title={error?.message}>
        {`Couldn't refresh ${noun}: ${error?.message ?? "Unknown error"}`}
      </span>
      <Button variant="outline" size="xs" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
