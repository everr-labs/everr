// The route-pattern resolver: a host-registered callback returning the
// active low-cardinality route pattern, sampled per record by the envelope
// (stamped as `everr.route.pattern`) and by the network signal (span
// names). A package-level function like identify/captureError: telemetry
// init runs before any router exists, and registration deliberately
// survives shutdown()/re-init (a consent flow re-initializes the SDK long
// after the router registered).

let provider: (() => string | null | undefined) | null | undefined;

/**
 * Registers a callback returning the active low-cardinality route pattern
 * (e.g. a TanStack route id like `/blog/$slug`, or a Next.js template like
 * `/blog/[slug]`). Sampled per record, so it always reflects the router's
 * current state with no per-navigation bookkeeping. Errors and nullish
 * returns are treated as "no pattern"; passing nullish unregisters.
 */
export function setRouteResolver(get: typeof provider): void {
  provider = get;
}

/** The current pattern; the host callback must never break capture. */
export function routePattern(): string | null | undefined {
  try {
    return provider?.();
  } catch {
    return undefined;
  }
}
