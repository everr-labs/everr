import { attributionAttributes } from "./attribution.js";
import { resolveTransport } from "./config.js";
import { createEmitter, noop } from "./emitter.js";
import { createEnvelope } from "./envelope.js";
import { startErrors } from "./errors.js";
import { bindIdentity, createIdentity, storeFor } from "./identity.js";
import { startInp } from "./inp.js";
import { startInteractions } from "./interactions.js";
import { startLogger } from "./logger.js";
import { watchNavigation } from "./navigation.js";
import { startNetwork } from "./network.js";
import { startPageviews } from "./pageview.js";
import { createSessionContext } from "./session.js";
import type { CaptureSignal, EverrClient, InitOptions } from "./types.js";
import { SDK_NAME, SDK_VERSION } from "./version.js";
import { startWebVitals } from "./webvitals.js";

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

  // Server runtimes resolve the "node" conditional export (server.ts),
  // which attaches to the app's OpenTelemetry SDK instead of this pipeline.
  // A bundler that still lands this entry off-browser (custom conditions,
  // exotic edge runtimes) gets the structural no-op rather than a crash.
  if (typeof window === "undefined") {
    // Visible, because landing here means the bundler misresolved: server
    // telemetry only works through the node export condition.
    console.warn(
      "[everr] browser entry loaded outside a browser; server telemetry needs the node export condition",
    );
    bindIdentity(INERT_IDENTITY);
    return INERT;
  }

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

  const [emit, flush, exitFlush, emitSpan] = createEmitter(
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
  // Patched after the emitter captured the original fetch, so SDK POSTs
  // bypass the patch structurally.
  const stopNetwork = enabled("network")
    ? startNetwork(emitSpan, options.tracePropagationTargets)
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
      stopNetwork?.();
      stopInteractions?.();
      pageviews?.[2]();
      stopWatching();
      return flush();
    },
  };
}

const INERT_IDENTITY = { identify: noop, revoke: noop };

const INERT: EverrClient = { flush: noop, shutdown: noop };
