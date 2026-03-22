import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

type SubscriptionOpts =
  | { scope: "tenant" }
  | { scope: "trace"; traceId: string };

export function useRealtimeSubscription(opts: SubscriptionOpts) {
  const queryClient = useQueryClient();
  const traceId = opts.scope === "trace" ? opts.traceId : undefined;

  useEffect(() => {
    const params = new URLSearchParams({ scope: opts.scope });
    if (traceId) {
      params.set("traceId", traceId);
    }

    const es = new EventSource(`/api/events/subscribe?${params.toString()}`);

    es.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as {
          type: string;
          traceId?: string;
        };
        if (data.type !== "update") return;

        if (opts.scope === "tenant") {
          void queryClient.invalidateQueries({ queryKey: ["runs"] });
        } else {
          void queryClient.invalidateQueries({
            queryKey: ["runs", "details", traceId],
          });
          void queryClient.invalidateQueries({
            queryKey: ["runs", "jobs", traceId],
          });
          void queryClient.invalidateQueries({
            queryKey: ["runs", "allJobsSteps", traceId],
          });
        }
      } catch {
        // ignore malformed events
      }
    };

    return () => {
      es.close();
    };
  }, [opts.scope, traceId, queryClient]);
}
