// The route resolvers. The host registers functions that change a URL into a
// route. There are two routes, and a record can carry the two:
//
// - `page`: the route pattern of the document that the user views. The SDK
//   calls it for each record with the page URL of that record, then writes the
//   result as `everr.route.pattern`.
// - `request`: the route template of an endpoint that the page contacts. The
//   network signal calls it for each request, then writes the result as the
//   semconv attribute `url.template`, and it uses it in the name of the span.
//
// The functions take the URL as their input, and they do not read the current
// state of the router. Thus a record that refers to a previous page is correct:
// page_leave uses the URL of the page that the user leaves, and not the page
// that the router shows now.
//
// This is a package function, the same as identify and captureError. The
// constructor of the WebSDK operates before a router exists. The registration
// continues after shutdown() and after a new construction, and this is correct.
// A consent procedure constructs the SDK again a long time after the router
// registers.

/**
 * Changes the URL of a request into its route template, which is the semconv
 * attribute `url.template`. That template has a small number of different
 * values. For example, it changes `/api/posts/123` into `/api/posts/{id}`.
 */
export type RouteTemplateResolver = (url: URL) => string | null | undefined;

/** The two route resolvers of the host. Each key is optional. */
export type RouteResolvers = {
  /**
   * Changes the URL of a page into its route pattern, for example a TanStack
   * route id `/blog/$slug` or a Next.js template `/blog/[slug]`. The result
   * goes on each record as `everr.route.pattern`. This is the route of the
   * document, and it has no relation to the requests of the page.
   */
  page?: ((url: string) => string | null | undefined) | null;
  /**
   * Changes the URL of a request into the route template of the endpoint, for
   * example `/api/posts/123` into `/api/posts/{id}`. The network signal uses
   * it as the name of the span, for example `GET /api/posts/{id}`, and it
   * writes it as the semconv attribute `url.template`. This is the route of
   * the request, and the router of the page cannot calculate it. Without it,
   * the name of a span is the path of the request.
   */
  request?: RouteTemplateResolver | null;
};

let resolvers: RouteResolvers | null | undefined;

/**
 * Registers the route resolvers. Each call replaces the whole registration.
 * If a function throws an error, or if it returns null or undefined, the
 * record gets no route. To remove the resolvers, send null or undefined.
 */
export function setRouteResolver(
  next: RouteResolvers | null | undefined,
): void {
  resolvers = next;
}

/** Gives the page pattern for `url`. The function from the host must never
 * cause a failure of the capture. */
export function routePattern(url: string): string | null | undefined {
  try {
    return resolvers?.page?.(url);
  } catch {
    return undefined;
  }
}

/** Gives the request template for `url`. The function from the host must never
 * cause a failure of fetch. */
export function requestTemplate(url: URL): string | null | undefined {
  try {
    return resolvers?.request?.(url);
  } catch {
    return undefined;
  }
}
