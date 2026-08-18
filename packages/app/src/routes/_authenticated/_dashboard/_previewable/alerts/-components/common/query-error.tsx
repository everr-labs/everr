import { RetryError } from "@everr/ui/components/retry-error";
import { useQueryClient } from "@tanstack/react-query";
import { alertingErrorInfo } from "@/data/alerting/errors";

// AlertingError fields survive server-fn serialization structurally. Status 0
// and transport-shaped messages represent service unavailability.
export function alertingErrorMessage(error: unknown): string {
  const info = alertingErrorInfo(error);
  if (info) {
    return info.status === 0 ? "Alerting service unavailable" : info.message;
  }
  if (error instanceof Error) {
    if (
      /fetch failed|failed to fetch|timeout|ECONNREFUSED/i.test(error.message)
    ) {
      return "Alerting service unavailable";
    }
    return error.message;
  }
  return "Unknown error";
}

export function AlertingQueryError({ error }: { error: unknown }) {
  const qc = useQueryClient();
  return (
    <RetryError
      variant="inline"
      message={alertingErrorMessage(error)}
      // Refetching under the "alerting" prefix re-runs exactly the queries
      // whose failure produced this card.
      onRetry={() => qc.refetchQueries({ queryKey: ["alerting"] })}
    />
  );
}
