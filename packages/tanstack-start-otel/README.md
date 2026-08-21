# @everr/tanstack-start-otel

OpenTelemetry instrumentation for TanStack Start. One SERVER span per request with a
parameterized `http.route`, and one span per server-function call, wired through Start's own
global middleware.

## Install

```bash
pnpm add @everr/tanstack-start-otel
```

## Use

Register both middlewares on the start instance:

```ts
// src/start.ts
import {
  createRequestTelemetryMiddleware,
  createServerFnTelemetryMiddleware,
  type RouterLike,
} from "@everr/tanstack-start-otel";
import { createStart } from "@tanstack/react-start";
import { getRouter } from "@/router";

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createRequestTelemetryMiddleware({ router: (): RouterLike => getRouter() }),
  ],
  functionMiddleware: [createServerFnTelemetryMiddleware()],
}));
```

Pass **your app's own router factory**, never a fresh `createRouter`. On the server router-core
caches the processed route tree on `globalThis.__TSR_CACHE__`, keyed only by route tree identity
and blind to the options that decide how the tree is processed (`routeMasks`, `caseSensitive`).
The first router built wins for the whole process, so a second one configured differently
inherits a tree that does not match its own options and crashes in `findFlatMatch`, in production
only.

Annotate the callback's return type as `RouterLike` when your generated `routeTree.gen` binds
`Register` to `getRouter`, or the start instance and the router become mutually inferred.

## What it emits

- A SERVER span named `<METHOD> <route-template>`, with `http.request.method`, `http.route`,
  `url.path`, `url.scheme`, and `http.response.status_code`.
- An `x-everr-route` response header carrying the derived template, so a browser SDK can stamp
  `url.template` on its client span. The client route tree has no server-only routes, so this
  header is its only exact source.
- One span per server-function call, named `serverFn {name}`, carrying
  `everr.server_function.name` and `everr.server_function.transport` (`http` or `in-process`).
  Over HTTP the request span is renamed from `/_serverFn/:id` to `/_serverFn/{name}` once the
  call resolves.

Disable the HTTP auto-instrumentation's incoming-request span
(`disableIncomingRequestInstrumentation: true`) so each request gets one SERVER span, not two.

## Options

| Option | Applies to | Purpose |
| --- | --- | --- |
| `router` | request | The app's router factory, called once and memoized. Required. |
| `tracerName` | both | Tracer name. Defaults to `tanstack-start.server` / `tanstack-start.server_fn`. |
| `isExpectedError` | server fn | Errors treated as control flow rather than faults, so they are not captured. |

## Note on CSRF

Defining a start instance replaces Start's default CSRF middleware. Once you set
`requestMiddleware`, include `createCsrfMiddleware()` in the array or server functions are left
unprotected.
