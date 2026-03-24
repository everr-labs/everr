import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { RealtimeSubscriptionMachine } from "./realtime-subscription-machine";

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

    const machine = new RealtimeSubscriptionMachine({
      url: `/api/events/subscribe?${params.toString()}`,
      onInvalidate: () => {
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
      },
    });
    machine.connect();
    return () => machine.dispose();
  }, [opts.scope, traceId, queryClient]);
}
