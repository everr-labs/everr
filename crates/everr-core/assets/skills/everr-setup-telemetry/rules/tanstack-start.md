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

Do not hand-roll this. `@everr/tanstack-start-otel` ships the request and server-function middleware, and the route-template derivation they share. Register both on the start instance, which is Start's own hook and runs for every request it serves, SSR and server functions alike.

```ts
// src/start.ts
import {
  createRequestTelemetryMiddleware,
  createServerFnTelemetryMiddleware,
  type RouterLike,
} from "@everr/tanstack-start-otel";
import { createStart } from "@tanstack/react-start";
import { getRouter } from "@/router";
import { isExpectedServerFunctionError } from "@/telemetry/expected-errors";

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createRequestTelemetryMiddleware({ router: (): RouterLike => getRouter() }),
  ],
  functionMiddleware: [
    createServerFnTelemetryMiddleware({
      isExpectedError: isExpectedServerFunctionError,
    }),
  ],
}));
```

`src/server.ts` then needs no telemetry wrapper: export `createStartHandler(...)` directly and import the NodeSDK setup module for its side effect.

Pass the app's own router factory, never a fresh `createRouter`. The server caches the processed route tree globally by route tree identity, ignoring the options that decide how it is processed (`routeMasks` and `caseSensitive`), so the first router built wins for the whole process. A separately configured second router makes every later render throw `Cannot read properties of null (reading 'get')`, in production only. Annotate the callback as `RouterLike` when `routeTree.gen` binds `Register` to `getRouter`, or the two become mutually inferred.

Defining a start instance replaces Start's default CSRF middleware. Once `requestMiddleware` is set, include `createCsrfMiddleware()` in the array or server functions are left unprotected.

The package emits a SERVER span named `<METHOD> <route-template>`, echoes the template on `x-everr-route` for the browser SDK to read into `url.template`, and names each server-function span `serverFn {name}`. Read its README for the full attribute list and options.

Disable the HTTP auto-instrumentation's incoming-request span (`disableIncomingRequestInstrumentation: true`) so each request gets one SERVER span, not two.

The derivation the package uses, for reference when debugging an unexpected `http.route`:

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

The package builds this matcher once per process from the factory you pass, and never from the router the framework builds to render: that one does not exist yet when the middleware needs `http.route`, and it is bound to a single request. The server matcher sees the full tree, API routes included.

Two things worth knowing when reading the output:

- Paths are parameterized before they become a span name or `http.route`; raw paths are unbounded cardinality.
- `propagation.extract` continues a trace a first-party client started (the browser, or the CLI injecting `traceparent`). A request without the header extracts to an empty context and the span roots itself.

### Server Functions

`createServerFnTelemetryMiddleware()` covers every server function, so no call site is instrumented by hand. It starts an INTERNAL span per invocation, named `serverFn {name}` from `serverFnMeta`, nested under the request's SERVER span because the request middleware's context is active.

Describe it with the server-function convention from the skill root: `everr.server_function.name` carries the function's own identifier verbatim, and `everr.server_function.transport` is `http` when the call arrived over `/_serverFn/` and `in-process` when it ran during SSR. The span stays INTERNAL: over HTTP the transport's SERVER span already counts the inbound request, and in-process there is no inbound request at all.

The transport span for a server function request only knows the opaque `/_serverFn/<id>` path, because Start declares `serverFnMeta` on the request middleware context but does not populate it there (checked at 1.169.23). The function middleware therefore reports the name back through an AsyncLocalStorage holder, and once the response settles the request middleware renames its SERVER span and the `x-everr-route` echo to `/_serverFn/{name}`, falling back to `/_serverFn/:id` when the middleware never ran. The browser's client span picks the name up from the echo, so all three spans of one call read as the same function.

TanStack Start signals control flow with throwables: `redirect()` and `notFound()` surface as thrown values inside server functions. Pass `isExpectedError` so they are not captured, or every redirect becomes a phantom error.

## Validation

Run the seam validation from `vite-ssr.md`. Additionally trigger one server function from the browser and verify its `serverFn {name}` INTERNAL span shares a `TraceId` with the browser request and the transport's `POST /_serverFn/{name}` SERVER span, and carries `everr.server_function.transport: http`.
