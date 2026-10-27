import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { RealtimeSubscriptionMachine } from "./realtime-subscription-machine";

type SubscriptionOpts = { scope: "tenant" } | { scope: "trace"; traceId: string };

export function useRealtimeSubscription(opts: SubscriptionOpts) {
  const queryClient = useQueryClient();
  const [scope, traceId] =
    opts.scope === "trace"
      ? ([opts.scope, opts.traceId] as const)
      : ([opts.scope, undefined] as const);

  useEffect(() => {
    const params = new URLSearchParams({ scope });
    if (scope === "trace") {
      params.set("key", traceId);
    }

    const machine = new RealtimeSubscriptionMachine({
      url: `/api/events/stream?${params.toString()}`,
      onInvalidate: () => {
        if (scope === "tenant") {
          void queryClient.invalidateQueries({ queryKey: ["runs"] });
          void queryClient.invalidateQueries({ queryKey: ["errors"] });
          void queryClient.invalidateQueries({ queryKey: ["recordings"] });
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
  }, [scope, traceId, queryClient]);
}
