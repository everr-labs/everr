// The route-pattern resolver: a host-registered URL -> pattern translator,
// called per record with the URL of the page that record belongs to and
// stamped as `everr.route.pattern`. Taking the URL as input (instead of
// sampling the router's live state) keeps records that reference a *past*
// page correct: page_leave resolves the outgoing page's URL, not whatever
// the router matches now. It describes the document, not any request the
// page makes, so the network signal resolves its own request route template
// instead of borrowing this one.
// A package-level function like identify/captureError: telemetry
// WebSDK construction runs before any router exists, and registration deliberately
// survives shutdown()/re-init (a consent flow re-initializes the SDK long
// after the router registered).

let provider: ((url: string) => string | null | undefined) | null | undefined;

/**
 * Registers a translator from a page URL to its low-cardinality route
 * pattern (e.g. a TanStack route id like `/blog/$slug`, or a Next.js
 * template like `/blog/[slug]`). Called per record with that record's page
 * URL, so records pinned to an earlier page (like page_leave) resolve
 * correctly. Errors and nullish returns are treated as "no pattern";
 * passing nullish unregisters.
 */
export function setRouteResolver(get: typeof provider): void {
  provider = get;
}

/** The pattern for `url`; the host callback must never break capture. */
export function routePattern(url: string): string | null | undefined {
  try {
    return provider?.(url);
  } catch {
    return undefined;
  }
}
