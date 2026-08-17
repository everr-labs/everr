import { Button } from "@everr/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
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
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <span>{alertingErrorMessage(error)}</span>
      <Button
        variant="outline"
        size="sm"
        // Refetching under the "alerting" prefix re-runs exactly the queries whose
        // failure produced this card.
        onClick={() => qc.refetchQueries({ queryKey: ["alerting"] })}
      >
        <RotateCw data-icon="inline-start" />
        Retry
      </Button>
    </div>
  );
}
