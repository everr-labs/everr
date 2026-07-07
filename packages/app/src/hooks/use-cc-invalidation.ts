import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { RealtimeSubscriptionMachine } from "./realtime-subscription-machine";

const CC_EVENTS_STREAM_URL = "/api/cc/events-stream";

// Trailing window: after the last CC event in a burst, wait this long before
// firing a single invalidation wave. A firing rule can emit many instance
// events back to back; coalescing them into one refetch keeps the alerting
// pages live without a refetch storm.
export const CC_INVALIDATION_DEBOUNCE_MS = 2000;

// A CC alert event (firing/resolved) changes exactly four query families:
//   - the everr-native alerts views (list + detail all live under the
//     ["alerts", …] prefix),
//   - the CC active-alert instances (["cc", "alerts"]),
//   - the CC rule rollups, which carry alert_state / firing_instance_count
//     (["cc", "rules"]),
//   - the stored CC event log (["cc", "event-history"]) — every event lands a
//     row there, and Triage reads it for evidence and recent transitions.
// Config queries (routes, receivers, inhibitions, silences) are NOT touched by
// alert events, so they are deliberately left out. TanStack matches by key
// prefix, so these four cover every derived query on all mount points.
export const CC_INVALIDATION_KEYS: QueryKey[] = [
  ["alerts"],
  ["cc", "alerts"],
  ["cc", "rules"],
  ["cc", "event-history"],
];

export interface TrailingDebounce {
  /** (Re)start the trailing timer; the wrapped fn runs once it fully elapses. */
  trigger: () => void;
  /** Cancel any pending run (used on teardown). */
  cancel: () => void;
}

/** Trailing-edge debounce: coalesces a burst of `trigger()`s into one `fn()`. */
export function createTrailingDebounce(
  fn: () => void,
  ms: number,
): TrailingDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export interface CcInvalidationStreamOpts {
  /** Called once per key when a settled burst of CC events should refetch. */
  invalidate: (queryKey: QueryKey) => void;
  /** Injected for tests; defaults to the global `EventSource`. */
  EventSourceCtor?: typeof EventSource;
  /** Trailing debounce window; defaults to CC_INVALIDATION_DEBOUNCE_MS. */
  debounceMs?: number;
}

export interface CcInvalidationStream {
  connect: () => void;
  dispose: () => void;
}

/**
 * Wires the CC SSE stream to a debounced, precise query invalidation.
 *
 * Connection lifecycle, `{type:"ping"}` heartbeat filtering, and bounded
 * reconnect (5 retries with exponential backoff, then permanent disconnect —
 * so a 401/502 endpoint never turns into a reconnect loop) are reused from
 * `RealtimeSubscriptionMachine`. Its per-message callback feeds a trailing
 * debounce so an event burst collapses into a single invalidation wave.
 */
export function createCcInvalidationStream(
  opts: CcInvalidationStreamOpts,
): CcInvalidationStream {
  const debounced = createTrailingDebounce(() => {
    for (const queryKey of CC_INVALIDATION_KEYS) opts.invalidate(queryKey);
  }, opts.debounceMs ?? CC_INVALIDATION_DEBOUNCE_MS);

  const machine = new RealtimeSubscriptionMachine({
    url: CC_EVENTS_STREAM_URL,
    onInvalidate: () => debounced.trigger(),
    EventSourceCtor: opts.EventSourceCtor,
  });

  return {
    connect: () => machine.connect(),
    dispose: () => {
      debounced.cancel();
      machine.dispose();
    },
  };
}

/**
 * Keeps the mounting page's alerting queries live: subscribes to the CC event
 * stream and invalidates the affected query keys (debounced) as alerts fire and
 * resolve. Mount it once per page. The connection is torn down on unmount.
 */
export function useCcInvalidation(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const stream = createCcInvalidationStream({
      invalidate: (queryKey) => {
        void queryClient.invalidateQueries({ queryKey });
      },
    });
    stream.connect();
    return () => stream.dispose();
  }, [queryClient]);
}
