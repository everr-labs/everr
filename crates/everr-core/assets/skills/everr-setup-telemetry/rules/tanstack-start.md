# TanStack Start Instrumentation

Use this rule for TanStack Start apps (Vite + Nitro, React). Read `vite-ssr.md` first: it owns the two-halves layout, environment split, and the browser-to-server seam. This rule adds only what TanStack Start changes.

## Browser Half

Follow `browser.md` for the `@everr/otel-web` setup. TanStack Start specifics:

- Put the `WebSDK` construction in a side-effect module and import it at the top of `src/routes/__root.tsx`, so it runs once when the client bundle loads. The WebSDK is inert during SSR, so no environment guard is needed.
- Register the router with the SDK's `page` route resolver so pageviews and errors carry the route template (`/blog/$slug`) instead of raw paths. Telemetry setup runs before the router exists, so bridge through an app-owned module. Register no `request` resolver: per the seam section of `vite-ssr.md`, request templates come from exact sources only, and here the exact source is the server's `x-everr-route` echo, never a guess from the shape of a path segment.

The route tree is the exact source, with one asymmetry: Start prunes server-only routes (files whose `createFileRoute` options hold only `server`) from the client route tree, so the browser cannot derive a template for the requests it makes. It does not try: the browser registers only the `page` resolver, and request templates arrive on the server's `x-everr-route` response header, which `@everr/otel-web`'s `network()` reads into `url.template` (see the server half below). An unmatched path has no template: `matchRoutes` falls through to the root/not-found match on unknown paths, and the shared `routeTemplate` helper (defined in the server half below, used by both sides) filters it rather than letting it leak as a pattern:

```ts
// src/telemetry/route-pattern.ts
import { setRouteResolver } from "@everr/otel-web";
import { type RouterLike, routeTemplate } from "./route-template";

/** Call from `getRouter()` right after creating the router. */
export function registerRouter(router: RouterLike): void {
  setRouteResolver({
    page: (url) => routeTemplate(router, new URL(url).pathname),
  });
}
```

## Server Half

Follow `nodejs.md` for the NodeSDK setup module, including the hot-reload guard: `vite dev` runs the server in-process and re-evaluates on reload.

### Request Spans In Global Request Middleware

Start's own hook for this is global request middleware, registered in `src/start.ts`. It runs for every request the framework serves, SSR and server functions alike. Prefer it over wrapping the fetch handler in `src/server.ts`: the wrapper works, but it sits outside the framework and has to re-derive things middleware is handed.

```ts
// src/start.ts
export const startInstance = createStart(() => ({
  requestMiddleware: [requestTelemetryMiddleware],
  functionMiddleware: [serverFnTelemetryMiddleware],
}));
```

```ts
// src/telemetry/server.ts
export const requestTelemetryMiddleware = createMiddleware({
  type: "request",
}).server(async ({ request, pathname, handlerType, next }) => {
  matcher ??= getRouter(); // the app's factory, not a second createRouter
  const route = routeTemplate(matcher, pathname);
  const method = request.method.toUpperCase();

  // The function middleware reports the name into this holder mid-flight.
  const serverFn = handlerType === "serverFn" ? {} : undefined;
  const resolved = () => (serverFn?.name ? `/_serverFn/${serverFn.name}` : route);
  const attrs = (route: string | undefined, extra?: Attributes) => ({
    "http.request.method": method,
    "url.path": pathname,
    ...(route === undefined ? {} : { "http.route": route }),
    ...extra,
  });

  return tracer.startActiveSpan(
    route === undefined ? method : `${method} ${route}`,
    { attributes: attrs(route), kind: SpanKind.SERVER },
    propagation.extract(context.active(), request.headers, headersGetter),
    async (span) => {
      let final = route;
      try {
        const result = await (serverFn
          ? runWithServerFunctionName(serverFn, () => next())
          : next());
        const { response } = result;
        final = resolved();

        // Immutable headers keep theirs; the span is unaffected.
        if (final !== undefined) {
          try { response.headers.set("x-everr-route", final); } catch {}
        }
        span.setAttribute("http.response.status_code", response.status);
        if (response.status >= 500) {
          captureError(new Error(`HTTP ${response.status}`), attrs(final, {
            "everr.error.source": "server.response",
            "http.response.status_code": response.status,
          }));
        }
        return result;
      } catch (error) {
        final = resolved();
        captureError(error, attrs(final, {
          "everr.error.source": "server.request",
        }));
        throw error;
      } finally {
        // The name is only final once the function middleware has run.
        if (final !== undefined && final !== route) {
          span.updateName(`${method} ${final}`);
          span.setAttribute("http.route", final);
        }
        span.end();
      }
    },
  );
});
```

`handlerType` is `"serverFn"` or `"router"`, so the kind of request never has to be guessed from the path. Note that `serverFnMeta` is declared on the request middleware context but is not populated there (checked at 1.169.23), so the function's name still has to come from the function middleware.

Defining a start instance replaces Start's default CSRF middleware. Once `requestMiddleware` is set, include `createCsrfMiddleware()` in the array or server functions are left unprotected.

```ts
// src/telemetry/route-template.ts: one route-template derivation, shared by
// the server's http.route stamping and the browser's page resolver above.
// Server function calls go over POST /_serverFn/<id>, a deterministic prefix
// outside the tree.
export type RouterLike = {
  matchRoutes(
    pathname: string,
  ): ReadonlyArray<{ routeId: string; fullPath: string }>;
};

export function routeTemplate(
  router: RouterLike,
  pathname: string,
): string | undefined {
  if (pathname.startsWith("/_serverFn/")) {
    return pathname.replace(/^\/_serverFn\/[^/]+/, "/_serverFn/:id");
  }
  const match = router.matchRoutes(pathname).at(-1);
  // Filter the root fallthrough and the generated not-found route: an
  // unmatched path has no template rather than a fake one. The fullPath drops
  // pathless segments such as /_authenticated from the template.
  return match === undefined ||
    match.routeId === "__root__" ||
    match.routeId.includes("404")
    ? undefined
    : match.fullPath;
}
```

Do not reuse the router the framework builds to render: it does not exist yet when the middleware needs `http.route`, and it is bound to a single request. Build a standalone matcher once and pass it to `routeTemplate`. The server sees the full tree, API routes included.

Build that matcher from the app's own router factory rather than a second `createRouter`. The server caches the processed route tree globally by route tree identity, ignoring the options that decide how it is processed (`routeMasks` and `caseSensitive`), so the first router built wins for the whole process and the matcher is built first. A separately configured matcher makes every later render throw `Cannot read properties of null (reading 'get')`, in production only.

Notes on the above:

- Parameterize the path before it becomes the span name or `http.route`; raw paths are unbounded cardinality.
- `propagation.extract` continues a trace a first-party client started (the browser, or the CLI injecting `traceparent`). A request without the header extracts to an empty context and the span roots itself.
- The `x-everr-route` echo is how the browser gets exact templates: `@everr/otel-web`'s `network()` reads it into `url.template`, and the client route tree has no server-only routes to derive them from.
- Disable the HTTP auto-instrumentation's incoming-request span (`disableIncomingRequestInstrumentation: true`) so each request gets one SERVER span, not two.

### Server Functions

Wrap every server function through global middleware in `src/start.ts` instead of instrumenting call sites:

```ts
// src/start.ts
import { createStart } from "@tanstack/react-start";
import { serverFnTelemetryMiddleware } from "@/telemetry/server-fn";

export const startInstance = createStart(() => ({
  functionMiddleware: [serverFnTelemetryMiddleware],
}));
```

The middleware (`createMiddleware({ type: "function" })`) starts an INTERNAL span per invocation, named `serverFn {name}` from `serverFnMeta`. It nests under the request's SERVER span automatically because the request middleware's context is active.

Describe it with the server-function convention from the skill root: `everr.server_function.name` carries the function's own identifier verbatim, and `everr.server_function.transport` is `http` when the call arrived over `/_serverFn/` and `in-process` when it ran during SSR. The span stays INTERNAL: over HTTP the transport's SERVER span already counts the inbound request, and in-process there is no inbound request at all.

The transport span for a server function request only knows the opaque `/_serverFn/<id>` path, so the function middleware reports the name back to the request middleware (an app-owned AsyncLocalStorage holder). After the response settles, the request middleware renames its SERVER span and the `x-everr-route` echo to `/_serverFn/{name}`, falling back to `/_serverFn/:id` when the middleware never ran. The browser's client span picks the name up from the echo, so all three spans of one call read as the same function.

TanStack Start signals control flow with throwables: `redirect()` and `notFound()` surface as thrown values inside server functions. Filter those out before calling `captureError`, or every redirect becomes a phantom error.

## Validation

Run the seam validation from `vite-ssr.md`. Additionally trigger one server function from the browser and verify its `serverFn {name}` INTERNAL span shares a `TraceId` with the browser request and the transport's `POST /_serverFn/{name}` SERVER span, and carries `everr.server_function.transport: http`.
