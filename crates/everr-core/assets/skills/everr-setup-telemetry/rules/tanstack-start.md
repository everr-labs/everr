# TanStack Start Instrumentation

Use this rule for TanStack Start apps (Vite + Nitro, React). Read `vite-ssr.md` first: it owns the two-halves layout, environment split, and the browser-to-server seam. This rule adds only what TanStack Start changes.

## Browser Half

Follow `browser.md` for the `@everr/otel-web` setup. TanStack Start specifics:

- Put the `WebSDK` construction in a side-effect module and import it at the top of `src/routes/__root.tsx`, so it runs once when the client bundle loads. The WebSDK is inert during SSR, so no environment guard is needed.
- Register the router with the SDK's `page` route resolver so pageviews and errors carry the route template (`/blog/$slug`) instead of raw paths. Telemetry setup runs before the router exists, so bridge through an app-owned module. Register no `request` resolver: per the seam section of `vite-ssr.md`, request templates come from exact sources only, and here the exact source is the server's `x-everr-route` echo, never a guess from the shape of a path segment.

The route tree is the exact source, with one asymmetry: Start prunes server-only routes (files whose `createFileRoute` options hold only `server`) from the client route tree, so the browser cannot derive a template for the requests it makes. It does not try: the browser registers only the `page` resolver, and request templates arrive on the server's `x-everr-route` response header, which `@everr/otel-web`'s `network()` reads into `url.template` (see the server half below). An unmatched path has no template: `matchRoutes` falls through to the root/not-found match on unknown paths, so filter it, do not let it leak as a pattern:

```ts
// src/telemetry/route-pattern.ts
import { setRouteResolver } from "@everr/otel-web";

type RouterLike = {
  matchRoutes(
    pathname: string,
  ): ReadonlyArray<{ routeId: string; fullPath: string }>;
};

/** Call from `getRouter()` right after creating the router. */
export function registerRouter(router: RouterLike): void {
  setRouteResolver({
    page: (url) => {
      const match = router.matchRoutes(new URL(url).pathname).at(-1);
      // Filter the root fallthrough and the generated not-found route, the
      // same as the server's routeTemplate. The fullPath drops pathless
      // segments such as /_authenticated from the template.
      return match === undefined ||
        match.routeId === "__root__" ||
        match.routeId.includes("404")
        ? undefined
        : match.fullPath;
    },
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
import { instrumentServerFetch } from "@/telemetry/server";
import "@/telemetry/node";

const startFetch = createStartHandler(defineHandlerCallback(defaultStreamHandler));

export default {
  fetch: (...args: Parameters<typeof startFetch>) =>
    instrumentServerFetch(args[0], () => startFetch(...args)),
};
```

```ts
// src/telemetry/route-template.ts: the server's http.route derivation, over
// the same generated tree the pages render from. Server function calls go over
// POST /_serverFn/<id>, a deterministic prefix outside the tree.
type RouterLike = {
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
  return match === undefined ||
    match.routeId === "__root__" ||
    match.routeId.includes("404")
    ? undefined
    : match.fullPath;
}
```

Do not reach for the app's `getRouter()` here (it depends on the per-request SSR lifecycle): build a standalone matcher once from the same generated tree, `createRouter({ routeTree, history: createMemoryHistory() })`, and pass it to `routeTemplate` when stamping `http.route`. The server sees the full tree, API routes included.

`instrumentServerFetch` starts a SERVER span named `<METHOD> <route-template>`:

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

The middleware (`createMiddleware({ type: "function" })`) starts an INTERNAL span per invocation with the function id, name, and filename from `serverFnMeta` as attributes (prefix non-semconv attributes with `everr.`). It nests under the request's SERVER span automatically because the fetch wrapper's context is active.

TanStack Start signals control flow with throwables: `redirect()` and `notFound()` surface as thrown values inside server functions. Filter those out before calling `captureError`, or every redirect becomes a phantom error.

## Validation

Run the seam validation from `vite-ssr.md`. Additionally trigger one server function from the browser and verify its INTERNAL span shares a `TraceId` with the browser request and the SERVER span.
