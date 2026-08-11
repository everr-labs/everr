// The resolver of the route pattern. The host registers a function that changes
// a URL into a pattern. The SDK calls it for each record with the URL of the
// page of that record, then writes the result as `everr.route.pattern`.
//
// The function takes the URL as its input, and it does not read the current
// state of the router. Thus a record that refers to a previous page is correct:
// page_leave uses the URL of the page that the user leaves, and not the page
// that the router shows now.
//
// The pattern describes the document, and it does not describe a request from
// the page. Thus the network signal finds its own route template for a request,
// and it does not use this pattern.
//
// This is a package function, the same as identify and captureError. The
// constructor of the WebSDK operates before a router exists. The registration
// continues after shutdown() and after a new construction, and this is correct.
// A consent procedure constructs the SDK again a long time after the router
// registers.

let provider: ((url: string) => string | null | undefined) | null | undefined;

/**
 * Registers a function that changes the URL of a page into its route pattern.
 * That pattern has a small number of different values. For example, a TanStack
 * route id is `/blog/$slug`, and a Next.js template is `/blog/[slug]`.
 *
 * The SDK calls the function for each record with the page URL of that record.
 * Thus a record for a previous page, for example page_leave, gets the correct
 * pattern. If the function throws an error, or if it returns null or undefined,
 * the record gets no pattern. To remove the function, send null or undefined.
 */
export function setRouteResolver(get: typeof provider): void {
  provider = get;
}

/** Gives the pattern for `url`. The function from the host must never cause a
 * failure of the capture. */
export function routePattern(url: string): string | null | undefined {
  try {
    return provider?.(url);
  } catch {
    return undefined;
  }
}
