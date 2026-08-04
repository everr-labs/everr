import { attributionAttributes } from "./attribution.js";
import { resolveTransport } from "./config.js";
import { createEmitter, noop } from "./emitter.js";
import { createEnvelope } from "./envelope.js";
import { startErrors, startReporting } from "./errors.js";
import { bindIdentity, createIdentity, storeFor } from "./identity.js";
import { startInp } from "./inp.js";
import { startInteractions } from "./interactions.js";
import { startLogger } from "./logger.js";
import { watchNavigation } from "./navigation.js";
import { startPageviews } from "./pageview.js";
import { createSessionContext } from "./session.js";
import type { CaptureSignal, EverrClient, InitOptions } from "./types.js";
import { startWebVitals } from "./webvitals.js";

declare const __PACKAGE_VERSION__: string | undefined;
const SDK_VERSION =
  typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev";
const SDK_NAME = "@everr/web-sdk";

export function init(options: InitOptions): EverrClient {
  // Structural no-op: a keyless production build builds no emitter and no
  // watcher, so nothing can ever issue a network request. identify()/revoke()
  // are wired to a safe no-op, so calling them never throws even though
  // nothing is ever persisted or sent.
  const transport = resolveTransport(options);
  if (!transport) {
    bindIdentity(INERT_IDENTITY);
    return INERT;
  }

  // Server runtimes (SSR in meta frameworks like Next.js or TanStack Start,
  // edge included) get the same pipeline with logger and captureError wired
  // and nothing browser-bound: no analytics signals, no session envelope, no
  // global listeners. So the one init() call works from shared code in both
  // module graphs.
  if (typeof window === "undefined") return initServer(options, transport);

  // Identity (visitor id, 30-minute-inactivity session, identify()/revoke())
  // runs over the store the persistence option picks: localStorage (the
  // default) is read back across reloads and tabs; memory dies with the
  // page. The event schema is identical either way.
  const identity = createIdentity(storeFor(options.persistence));
  const stopIdentity = bindIdentity(identity);

  const [rotate, current] = createSessionContext(
    location.href,
    document.referrer,
    identity.session,
  );

  const [emit, flush, exitFlush] = createEmitter(
    ...transport,
    // Viewport is deliberately absent: it changes on resize, so it rides
    // the click payload per event instead of being frozen into the
    // resource.
    {
      "service.name": options.serviceName,
      "service.namespace": "everr",
      "service.version": options.serviceVersion ?? SDK_VERSION,
      "deployment.environment.name": options.deploymentEnvironment,
      "everr.sdk.name": SDK_NAME,
      "everr.sdk.version": SDK_VERSION,
      "user_agent.original": navigator.userAgent,
      "everr.screen.width": screen.width,
      "everr.screen.height": screen.height,
      "everr.timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
      "everr.language": navigator.language,
    },
    { name: SDK_NAME, version: SDK_VERSION },
    createEnvelope(
      current,
      attributionAttributes(location.search),
      identity.attrs,
      options.routePattern,
    ),
  );

  // The navigation watcher always runs so the envelope's page context stays
  // fresh for every signal; the disable list only gates the signal listeners.
  const off = options.disable;
  const enabled = (signal: CaptureSignal) =>
    off !== true && !off?.includes(signal);
  const pageviews = enabled("pageviews")
    ? startPageviews(emit, current)
    : undefined;
  const stopWatching = watchNavigation(rotate, pageviews ? [pageviews[0]] : []);
  const stopInteractions = enabled("interactions")
    ? startInteractions(emit)
    : undefined;
  const stopWebVitals = enabled("webVitals") ? startWebVitals(emit) : undefined;
  // One Event Timing observer serves both signals: slow_interaction records
  // ride the interactions toggle, the INP vital the webVitals toggle.
  const stopInp =
    enabled("interactions") || enabled("webVitals")
      ? startInp(emit, enabled("interactions"), enabled("webVitals"))
      : undefined;
  // Errors have no disable key and no options: capture is native and always
  // on whenever the SDK emits at all. Same for the custom logger: it only
  // emits when the user calls it.
  const stopErrors = startErrors(emit);
  const stopLogger = startLogger(emit);

  // Exit delivery: the final leave plus whatever is batched rides the
  // keepalive path. pagehide and visibilitychange-hidden, not beforeunload
  // (which never fires on mobile and breaks bfcache).
  const onHide = () => {
    pageviews?.[1]();
    exitFlush();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") onHide();
  };
  addEventListener("pagehide", onHide);
  addEventListener("visibilitychange", onVisibilityChange);

  return {
    flush,
    shutdown: () => {
      removeEventListener("pagehide", onHide);
      removeEventListener("visibilitychange", onVisibilityChange);
      stopIdentity();
      stopLogger();
      stopErrors();
      stopWebVitals?.();
      stopInp?.();
      stopInteractions?.();
      pageviews?.[2]();
      stopWatching();
      return flush();
    },
  };
}

// Node when present; absent on edge runtimes, where both attrs just drop.
declare const process:
  | { release?: { name?: string }; versions?: { node?: string } }
  | undefined;

// The server half of init(). Delivery note: the hosted ingest denies public
// origin-bound keys on origin-less (server-to-server) requests, so the
// server-side `ingestKey` must be a secret key; explicit `endpoint`
// overrides and the dev collector fallback behave the same as in the
// browser. Serverless hosts should `flush()` (or waitUntil it) before the
// runtime freezes; the batch timer is unref'd and never holds the process.
function initServer(
  options: InitOptions,
  transport: NonNullable<ReturnType<typeof resolveTransport>>,
): EverrClient {
  const [emit, flush] = createEmitter(
    ...transport,
    {
      "service.name": options.serviceName,
      "service.version": options.serviceVersion ?? SDK_VERSION,
      "deployment.environment.name": options.deploymentEnvironment,
      "everr.sdk.version": SDK_VERSION,
      "process.runtime.name":
        typeof process === "undefined" ? undefined : process.release?.name,
      "process.runtime.version":
        typeof process === "undefined" ? undefined : process.versions?.node,
    },
    { name: SDK_NAME, version: SDK_VERSION },
    // No envelope: session, page, and attribution context are per-tab
    // concepts. Server records are distinguished by their resource (runtime
    // attrs present, browser attrs absent) and carry no session.id.
    () => ({}),
  );

  const stopReporting = startReporting(emit);
  const stopLogger = startLogger(emit);
  // Identity is browser-bound; on the server identify()/revoke() bind to a
  // safe no-op so shared-code calls never throw. Per-process identity on
  // server records would leak users across requests.
  const stopIdentity = bindIdentity(INERT_IDENTITY);

  return {
    flush,
    shutdown: () => {
      stopIdentity();
      stopLogger();
      stopReporting();
      return flush();
    },
  };
}

const INERT_IDENTITY = { identify: noop, revoke: noop };

const INERT: EverrClient = { flush: noop, shutdown: noop };
