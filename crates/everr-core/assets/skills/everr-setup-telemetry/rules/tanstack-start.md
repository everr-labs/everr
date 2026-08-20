# TanStack Start Instrumentation

Use this rule for TanStack Start apps (Vite + Nitro, React). Read `vite-ssr.md` first: it owns the two-halves layout, environment split, and the browser-to-server seam. This rule adds only what TanStack Start changes.

## Browser Half

Follow `browser.md` for the `@everr/otel-web` setup. TanStack Start specifics:

- Put the `WebSDK` construction in a side-effect module imported at the top of `src/routes/__root.tsx`, so it runs once when the client bundle loads. The WebSDK is inert during SSR, so no environment guard is needed.
- Register the router with the SDK's `page` resolver only, so pageviews and errors carry the route template (`/blog/$slug`) instead of raw paths. Telemetry setup runs before the router exists, so bridge through an app-owned module.

Register no `request` resolver. Start prunes server-only routes from the client tree, so the browser cannot derive templates for the requests it makes and must not guess: they arrive on the server's `x-everr-route` echo, which `network()` reads into `url.template`.

```ts
// src/telemetry/route-pattern.ts
import { setRouteResolver } from "@everr/otel-web";
import { type RouterLike, routeTemplate } from "@everr/tanstack-start-otel";

/** Call from `getRouter()` right after creating the router. */
export function registerRouter(router: RouterLike): void {
  setRouteResolver({
    page: (url) => routeTemplate(router, new URL(url).pathname),
  });
}
```

## Server Half

Follow `nodejs.md` for the NodeSDK setup module, including the hot-reload guard: `vite dev` runs the server in-process and re-evaluates on reload.

`@everr/tanstack-start-otel` ships both middlewares and the route-template derivation they share; its README documents the spans and attributes. Register them on the start instance, Start's own hook, which covers SSR and server functions alike.

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

Four things bite here:

- **Pass the app's own router factory, never a fresh `createRouter`.** The server caches the processed route tree globally by tree identity, ignoring the options that decide how it is processed (`routeMasks`, `caseSensitive`), so the first router built wins for the process. A second, differently configured one makes every later render throw `Cannot read properties of null (reading 'get')`, in production only. Annotate the callback as `RouterLike` when `routeTree.gen` binds `Register` to `getRouter`, or the two infer through each other.
- **Defining a start instance replaces Start's default CSRF middleware.** Once `requestMiddleware` is set, include `createCsrfMiddleware()` in the array or server functions are left unprotected.
- **Disable the HTTP auto-instrumentation's incoming-request span** (`disableIncomingRequestInstrumentation: true`) so each request gets one SERVER span, not two.
- **Pass `isExpectedError`.** Start signals control flow with throwables, so `redirect()` and `notFound()` surface as thrown values inside server functions and otherwise become phantom errors.

## Validation

Run the seam validation from `vite-ssr.md`. Additionally trigger one server function from the browser and verify its `serverFn {name}` INTERNAL span shares a `TraceId` with the browser request and the transport's `POST /_serverFn/{name}` SERVER span, and carries `everr.server_function.transport: http`.
