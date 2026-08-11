import {
  errors,
  interactions,
  network,
  pageLoad,
  pageviews,
  performance,
  WebSDK,
} from "@everr/otel-web";
import { readConsent } from "@/telemetry/consent";

// The browser telemetry of the web app, and this app uses our own product. The
// page views, the frustration clicks, the web vitals, and the errors go to Everr
// as OTel log records. They use a browser service name, and that name is
// different from the name of the server in `node.ts`. Thus a query can select
// one of the two.
//
// The errors() instrumentation of the SDK captures the errors. It uses
// window.onerror and the unhandledrejection event. The error component of the
// router reports through `captureError`. Each error record carries the same
// analytics envelope.
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
  // The caller must select the capture. This app uses all the built-in
  // instrumentations. By default performance() includes the load window of the
  // page, which gives the resource spans and the long-animation-frame records.
  instrumentations: [
    errors(),
    pageviews(),
    interactions(),
    performance(),
    pageLoad(),
    // The request route template comes from the `request` route resolver in
    // route-pattern.ts.
    network(),
  ],
});
