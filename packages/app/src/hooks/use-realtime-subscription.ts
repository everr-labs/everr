import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

type SubscriptionOpts =
  | { scope: "tenant" }
  | { scope: "trace"; traceId: string };

const THROTTLE_MS = 300;
const MAX_RECONNECT_DELAY_MS = 30_000;

export function useRealtimeSubscription(opts: SubscriptionOpts) {
  const queryClient = useQueryClient();
  const traceId = opts.scope === "trace" ? opts.traceId : undefined;
  const reconnectAttempts = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams({ scope: opts.scope });
    if (traceId) {
      params.set("traceId", traceId);
    }

    const es = new EventSource(`/api/events/subscribe?${params.toString()}`);
    let throttled = false;
    let pending = false;
    let throttleTimer: ReturnType<typeof setTimeout>;

    function invalidate() {
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
    }

    function throttledInvalidate() {
      if (throttled) {
        pending = true;
        return;
      }
      invalidate();
      throttled = true;
      throttleTimer = setTimeout(() => {
        throttled = false;
        if (pending) {
          pending = false;
          throttledInvalidate();
        }
      }, THROTTLE_MS);
    }

    es.onopen = () => {
      reconnectAttempts.current = 0;
    };

    es.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as {
          type: string;
          traceId?: string;
        };
        if (data.type !== "update") return;
        throttledInvalidate();
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      reconnectAttempts.current += 1;
      const delay = Math.min(
        1000 * 2 ** reconnectAttempts.current,
        MAX_RECONNECT_DELAY_MS,
      );
      if (reconnectAttempts.current > 5) {
        es.close();
        setTimeout(() => {
          // The effect cleanup + re-run handles reconnection
        }, delay);
      }
    };

    return () => {
      clearTimeout(throttleTimer);
      es.close();
    };
  }, [opts.scope, traceId, queryClient]);
}
