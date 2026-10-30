# @everr/otel-web

Browser telemetry as OpenTelemetry log records: page views, interactions, web vitals, network spans, and errors. One small SDK, one OTLP endpoint, no separate analytics vendor.

Capture is opt-in. A bare `new WebSDK()` wires the pipeline and identity and captures nothing; you compose the instrumentations you want.

## Install

```bash
pnpm add @everr/otel-web
```

`@opentelemetry/api`, `@opentelemetry/api-logs`, and `react` are optional peers, needed only for the server entry and the React entry.

## Use

```ts
import { errors, interactions, network, pageviews, performance, WebSDK } from "@everr/otel-web";

new WebSDK({
  serviceName: "acme-web",
  deploymentEnvironment: import.meta.env.MODE,
  ingestKey: import.meta.env.VITE_EVERR_PUBLIC_INGEST_KEY,
  dev: import.meta.env.DEV,
  instrumentations: [errors(), pageviews(), interactions(), performance(), network()],
});
```

Without a key or an endpoint, a production build resolves to an inert client that never issues a request. In dev it falls back to the local collector on `127.0.0.1:54418`.

## Instrumentations

| Instrumentation  | Captures                                                                       |
| ---------------- | ------------------------------------------------------------------------------ |
| `errors()`       | `window` errors and unhandled rejections, with `ignore` and `denyUrls` filters |
| `pageviews()`    | Page views and page leaves, across SPA navigations                             |
| `interactions()` | Clicks and submits                                                             |
| `performance()`  | Web vitals and slow-interaction spans                                          |
| `network()`      | `fetch` and XHR as client spans                                                |

Wrap any instrumentation in `sampled(instrumentation, rate)` to capture a fraction of sessions, for example `sampled(performance(), 0.1)`.

### Network requests

`network()` captures both `fetch` and XMLHttpRequest. XHR spans run from `send()` through completion, including synchronous requests. Both transports use the same request route resolver, `x-everr-route` response header, URL sanitization, and `tracePropagationTargets` option. Cross-origin propagation requires the server to allow `traceparent` in its CORS headers; reading a cross-origin route echo also requires `Access-Control-Expose-Headers: x-everr-route`.

Everr owns XHR trace propagation: do not set `traceparent` yourself or use another XHR tracing library alongside `network()`. XHR appends repeated header values, which would produce an invalid trace header. HTTP 4xx/5xx responses, timeouts, and network failures mark the span as an error; intentional XHR cancellation does not. Shutdown restores the patched methods and discards unfinished XHR observations without cancelling application requests.

### Event and span timestamps

Custom instrumentations can set the time when an event happened as integer epoch milliseconds. Browser APIs expose values such as `Event.timeStamp` and `PerformanceEntry.startTime` relative to `performance.timeOrigin`; convert those values with `epoch()`. Without a timestamp, the SDK uses the instant `emit` is called.

```ts
import { epoch, type Instrumentation } from "@everr/otel-web";

const checkoutTiming: Instrumentation = ({ emit, tracer }) => {
  const onClick = (event: MouseEvent) => {
    emit("checkout.started", {}, epoch(event.timeStamp));

    const span = tracer.startSpan("prepare checkout", {
      startTime: epoch(event.timeStamp),
    });
    prepareCheckout().finally(() => span.end());
  };

  addEventListener("click", onClick);
  return () => removeEventListener("click", onClick);
};
```

`startTime` and `span.end(endTime)` accept epoch milliseconds, a `Date`, or an `HrTime` tuple of `[seconds, nanoseconds]`. A fractional millisecond rounds to the nearest millisecond. Any other value uses the current time. Log timestamps stay epoch milliseconds. Built-in instrumentations still convert browser performance entries and DOM events with `epoch()` at the capture site. Each logs payload is ordered by event timestamp, and each traces payload is ordered by span start time. Records with the same timestamp keep their capture order.

## Manual capture

```ts
import { captureError, identify, logger, setAttributes } from "@everr/otel-web";

logger.info("checkout started", { "cart.size": 3 });
captureError(error, { "order.id": id });
identify("u_123", { plan: "pro" });
setAttributes({ "feature.flag.new_nav": true });
```

React error boundaries live in a dedicated entry, so the core stays framework-free:

```tsx
import { ErrorBoundary } from "@everr/otel-web/react";

<ErrorBoundary fallback={<Oops />}>{children}</ErrorBoundary>;
```

### Custom interaction segments

Import `tracer` alongside `logger` to time application work after constructing a `WebSDK`. Custom spans use the same batching, context envelope, and `beforeSend` hook as built-in instrumentation. They default to `INTERNAL` spans; `options.kind` can override that.

```ts
import { tracer } from "@everr/otel-web";

await tracer.startActiveSpan("checkout", async (interaction) => {
  try {
    const segment = tracer.startSpan("prepare checkout", {
      attributes: { "everr.checkout.step": "prepare" },
    });
    try {
      await prepareCheckout();
    } finally {
      segment.end();
    }

    await submitCheckout();
  } finally {
    interaction.end();
  }
});
```

`startSpan()` measures one segment without making it active. In the browser, `startActiveSpan()` makes a span active until `span.end()`, including across `await`. Both share the active stack with built-in instrumentation, so network requests made while an interaction is active become its children. Always end spans in `finally`; returning or throwing from the callback does not end them automatically.

Browser parenting follows time: overlapping work joins the most recently active span, including work from another interaction. The context argument is ignored. `root: true` starts a new trace, and `startActiveSpan` with that option still stays active until `end()`. A log emitted during `startActiveSpan`, until `end()`, carries that span's trace id, span id, and trace flags. A log with its own timestamp joins only a span that was already active at that timestamp. `beforeSend` does not see those fields: the SDK writes them after the hook. Attributes may be scalars or arrays. Links record `traceId`, `spanId`, `traceFlags`, and attributes. `setStatus` records `OK` and `ERROR`; `OK` sticks, and the message is kept only for `ERROR`. `addEvent` and `recordException` record nothing. Use `setStatus({ code: 2 })` for a failed segment.

Before initialization, after shutdown, or with only a keyless production SDK, the browser tracer returns non-recording spans and still runs callbacks. An imported tracer follows SDK replacement. On the server, it uses the application's registered OpenTelemetry provider and context manager, without requiring a `WebSDK`; the provider controls export and async context propagation there.

## Session recording

`recording()` from `@everr/otel-web/recording` keeps the last 5 minutes of the page in memory with [rrweb](https://github.com/rrweb-io/rrweb). Nothing leaves the page until a Clip is emitted: automatically on an error from `errors()` or a failed request from `network()` (up to 5 per page), or by you.

```ts
import { WebSDK, errors, network, sampled } from "@everr/otel-web";
import { recorder, recording } from "@everr/otel-web/recording";

new WebSDK({
  serviceName: "acme-web",
  ingestKey: import.meta.env.VITE_EVERR_PUBLIC_INGEST_KEY,
  instrumentations: [errors(), network(), sampled(recording(), 0.2)],
});

recorder.emitClip({ last: 15_000 }); // send the last 15 seconds
recorder.emitClip(); // send the whole buffer, up to 5 minutes

const flow = recorder.startClip(); // records from here until end()
try {
  await submitOrder();
} finally {
  flow.end();
}
```

A Clip from `startClip()` holds only what happens between the call and `end()`, and closes after 60 seconds at the latest (`next` sets a shorter close). Pass `last` to start it that many milliseconds before the call instead. Automatic Clips cover 60 seconds before the error or failed request and 10 seconds after it.

Wrap `recording()` in `sampled()` to record a share of Sessions. Only a sampled Session downloads the recorder chunk, and the decision holds for the whole page. Text, inputs, `title`, `placeholder`, `aria-label`, `content` and `data-*` attributes are masked, and media is blocked. URLs keep no query or fragment. Change this with `mask`, `unmask`, `block`, `ignore`, `maskFn`, `maskAttributes`, `maskAllText`, `maskAllInputs` and `blockAllMedia`, or mark elements with the `everr-mask`, `everr-block` and `everr-ignore` classes or `data-everr-*` attributes. Password fields are always masked.

## Identity

`persistence: "localStorage"` (the default) keeps a random visitor id and 30-minute-inactivity sessions across reloads and tabs. `persistence: "memory"` uses zero cookies and zero storage: the same ids exist only in JS memory and die with the page.

The event schema is identical either way. A consent-gated app boots with `"memory"` and constructs a new WebSDK with `"localStorage"` once consent is granted.

## Sensitive data

The SDK removes nothing. `url.full` carries the full `location.href`, query string included, and an error message ships verbatim.

It does refuse to look in places: it reads no content of the DOM at all, so no field value and no element text ever reach a record. An element is identified by its tag, a stable selector, and the href of the link containing it. It also skips password and hidden inputs and ignores everything under a `.everr-no-capture` element.

That matches the other browser SDKs: OpenTelemetry sends an XPath, Sentry sends a selector tree, Faro sends a `data-` attribute the developer wrote. None of them reads rendered text either.

`beforeSend` runs on every log record and every span, with the SDK envelope already merged in, so one policy covers all signals. Return `null` to drop the item.

```ts
new WebSDK({
  serviceName: "acme-web",
  instrumentations: [pageviews(), network()],
  beforeSend: (item) => {
    const url = item.attributes["url.full"];
    if (typeof url === "string") item.attributes["url.full"] = url.split("?")[0];
    return item;
  },
});
```

`item.kind` is `"log"` or `"span"`. Narrow on it when you only care about one:

```ts
beforeSend: (item) =>
  item.kind === "span" && item.name === "GET /healthz" ? null : item,
```

It covers pageviews, `page_leave`, interactions, web vitals, exceptions, `logger.*` calls and every span, and it runs on the server entry too, so an isomorphic `logger` call behaves the same in both graphs. It runs last, after `sampled()` and any instrumentation filter, so it cannot bring back what those dropped. Ids and timestamps are not exposed: a hook rewrites what an item says, not which trace it belongs to.

A hook that throws drops that item and warns once, matching Faro and Sentry, which both fail closed. Your hook never throws into the page.

> `@everr/otel-errors` also has a `beforeSend`. It is a different hook on a different client: it takes an error event, not a `SendEvent`, and it covers Node crashes and server `captureError`. Wiring both packages means configuring both.

## Host-owned transport

An app that proxies its own telemetry (a Tauri or Electron renderer, a service worker, a test harness) takes over delivery with `send`. It receives one OTLP/JSON payload per signal, and the SDK issues no request of its own:

```ts
import { invoke } from "@tauri-apps/api/core";

new WebSDK({
  serviceName: "acme-desktop",
  send: (signal, body) => invoke("proxy_otlp", { signal, body }),
  instrumentations: [errors()],
});
```

`ingestKey`, `endpoint`, and `dev` are unused in this mode. Delivery stays best-effort: a throwing or rejecting `send` is swallowed exactly as a failed fetch is. Returning a promise makes `flush()` await it. The browser keepalive byte budget does not apply, so the exit flush ships the whole batch instead of truncating it.

## Server rendering

The `node` export condition resolves a server entry, so isomorphic code can import `logger` and `captureError` from the same specifier. On the server the SDK owns no pipeline: it attaches to the OpenTelemetry SDK your app already registered, and records join the request trace. WebSDK options are accepted and inert there, and lifecycle belongs to your `NodeSDK` handle.

`captureError` needs no `WebSDK` on the server. The first call wires it to [`@everr/otel-errors`](https://github.com/everr-labs/everr/tree/main/packages/otel-errors)' shared client, so whatever hooks you `configure` there cover these records too, and `shutdown()` leaves error capture running. `logger` keeps the gate: it needs a constructed `WebSDK`, and goes silent after `shutdown()`.

For Node process crashes, register that package's `ErrorsInstrumentation` on your `NodeSDK`.

## License

Apache-2.0. See [LICENSE](./LICENSE).
