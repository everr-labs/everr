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

### Request Spans In The Server Entry

The framework entrypoint for server telemetry is a custom `src/server.ts`: import the setup module first, then wrap the Start fetch handler so every request gets a SERVER span.

```ts
// src/server.ts
import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { instrumentFetch } from "@/telemetry/server";
import "@/telemetry/node";

const startFetch = createStartHandler(defineHandlerCallback(defaultStreamHandler));

export default {
  fetch: instrumentFetch(startFetch),
};
```

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

Do not reuse the router the framework builds to render: it does not exist yet when the wrapper needs `http.route`, and it is bound to a single request. Build a standalone matcher once and pass it to `routeTemplate`. The server sees the full tree, API routes included.

Build that matcher from the same factory as the app router, behind a flag that skips the query client and the telemetry registration. The server caches the processed route tree globally by route tree identity, ignoring the options that decide how it is processed (`routeMasks` and `caseSensitive`), so the first router built wins for the whole process and the matcher is built first. A separately configured matcher makes every later render throw `Cannot read properties of null (reading 'get')`, in production only.

`instrumentFetch` wraps the handler and starts a SERVER span named `<METHOD> <route-template>`:

- Extract the parent context from the request headers with `propagation.extract` so browser-injected `traceparent` (and any first-party client's) parents the span. Requests without the header extract to an empty context and root themselves.
- Parameterize the path before it becomes the span name or `http.route`; raw paths are unbounded cardinality.
- Set `http.response.status_code` from the response; capture 5xx responses and thrown errors with `captureError`.
- Echo the derived route on the response: `response.headers.set("x-everr-route", route)` when a route matched. The browser's `network()` reads this header into `url.template`, which is how browser request spans get exact templates for the server-only routes the client tree cannot see.
- When wrapping the handler this way, disable the HTTP auto-instrumentation's incoming-request span (`disableIncomingRequestInstrumentation: true`) so each request gets one SERVER span, not two.

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

The middleware (`createMiddleware({ type: "function" })`) starts an INTERNAL span per invocation, named `serverFn {name}` from `serverFnMeta`. It nests under the request's SERVER span automatically because the fetch wrapper's context is active.

Describe it with the server-function convention from the skill root: `everr.server_function.name` carries the function's own identifier verbatim, and `everr.server_function.transport` is `http` when the call arrived over `/_serverFn/` and `in-process` when it ran during SSR. The span stays INTERNAL: over HTTP the transport's SERVER span already counts the inbound request, and in-process there is no inbound request at all.

The transport span for a server function request only knows the opaque `/_serverFn/<id>` path, so the middleware reports the function name back to the fetch wrapper (an app-owned AsyncLocalStorage holder around the handler). After the response settles, the wrapper renames its SERVER span and the `x-everr-route` echo to `/_serverFn/{name}`, falling back to `/_serverFn/:id` when the middleware never ran. The browser's client span picks the name up from the echo, so all three spans of one call read as the same function.

TanStack Start signals control flow with throwables: `redirect()` and `notFound()` surface as thrown values inside server functions. Filter those out before calling `captureError`, or every redirect becomes a phantom error.

## Validation

Run the seam validation from `vite-ssr.md`. Additionally trigger one server function from the browser and verify its `serverFn {name}` INTERNAL span shares a `TraceId` with the browser request and the transport's `POST /_serverFn/{name}` SERVER span, and carries `everr.server_function.transport: http`.
