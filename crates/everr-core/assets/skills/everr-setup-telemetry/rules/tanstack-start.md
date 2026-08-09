# TanStack Start Instrumentation

Use this rule for TanStack Start apps (Vite + Nitro, React). Read `vite-ssr.md` first: it owns the two-halves layout, environment split, and the browser-to-server seam. This rule adds only what TanStack Start changes.

## Browser Half

Follow `browser.md` for the `@everr/otel-web` setup. TanStack Start specifics:

- Put the `WebSDK` construction in a side-effect module and import it at the top of `src/routes/__root.tsx`, so it runs once when the client bundle loads. The WebSDK is inert during SSR, so no environment guard is needed.
- Register the router with the SDK's route resolver so pageviews and errors carry the route id (`/blog/$slug`) instead of raw paths. Telemetry setup runs before the router exists, so bridge through an app-owned module:

```ts
// src/telemetry/route-pattern.ts
import { setRouteResolver } from "@everr/otel-web";

type RouterLike = {
  matchRoutes(pathname: string): ReadonlyArray<{ routeId: string }>;
};

/** Call from `getRouter()` right after creating the router. */
export function registerRouter(router: RouterLike): void {
  setRouteResolver((url) => {
    const matches = router.matchRoutes(new URL(url).pathname);
    return matches[matches.length - 1]?.routeId;
  });
}
```

- Server function calls go over `POST /_serverFn/<id>`. Give `network()` a `resolveRouteTemplate` that parameterizes that path (for example to `/_serverFn/:id`) with the same helper the server uses for `http.route`, per the seam section of `vite-ssr.md`.

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

`instrumentServerFetch` starts a SERVER span named `<METHOD> <route-template>`:

- Extract the parent context from the request headers with `propagation.extract` so browser-injected `traceparent` (and any first-party client's) parents the span. Requests without the header extract to an empty context and root themselves.
- Parameterize the path before it becomes the span name or `http.route`; raw paths are unbounded cardinality.
- Set `http.response.status_code` from the response; capture 5xx responses and thrown errors with `captureError` and `error.handled: false`.
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
