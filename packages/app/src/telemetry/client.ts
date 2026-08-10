import {
  errors,
  interactions,
  network,
  pageviews,
  performance,
  WebSDK,
} from "@everr/otel-web";
import { readConsent } from "@/telemetry/consent";
import { parameterizeTelemetryPath } from "@/telemetry/paths";

// The browser telemetry of the web app, and this app uses our own product. The
// page views, the frustration clicks, the web vitals, and the errors go to Everr
// as OTel log records. They use a browser service name, and that name is
// different from the name of the server in `node.ts`. Thus a query can select
// one of the two.
//
// The errors() instrumentation of the SDK captures the errors. It uses
// window.onerror, the unhandledrejection event, and the error component of the
// router through the `captureReactError` function that this module exports
// again. Each error record carries the same analytics envelope.
//
// The consent cookie in the store gives the initial persistence. Until the user
// gives consent, the SDK uses the memory store, which writes nothing and whose
// ids end with the page. A change of the consent changes the current client with
// setPersistence() or revoke(). Refer to telemetry/consent-gate.tsx. This module
// only selects the initial mode.
//
// The WebSDK does nothing on the server. Without a key, and not in the
// development mode, it makes no network request. In the development mode it
// sends the data to the local collector. The TanStack adapter gives the route
// pattern with setRouteResolver, and `getRouter()` registers the router with
// that adapter.
new WebSDK({
  persistence: readConsent() === "granted" ? "localStorage" : "memory",
  serviceName: "everr-dev-app-web",
  deploymentEnvironment: import.meta.env.MODE,
  ingestKey: import.meta.env.VITE_EVERR_PUBLIC_INGEST_KEY,
  endpoint: import.meta.env.VITE_EVERR_INGEST_ENDPOINT,
  dev: import.meta.env.DEV,
  // The caller must select the capture. This app uses all the built-in
  // instrumentations. By default performance() includes the load window of the
  // page, which gives the resource spans and the long-animation-frame records.
  instrumentations: [
    errors(),
    pageviews(),
    interactions(),
    performance(),
    // This gives the same parameters as the http.route attribute of the server.
    // Thus the url.template value of a request is the same as the route of its
    // server span. This is important for /_serverFn/:id.
    network({
      resolveRouteTemplate: (url) => parameterizeTelemetryPath(url.pathname),
    }),
  ],
});
