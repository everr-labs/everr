import { attributionAttributes } from "./attribution.js";
import { resolveTransport } from "./config.js";
import { bindEmit } from "./current.js";
import { createEmitter, noop } from "./emitter.js";
import { createEnvelope } from "./envelope.js";
import { startErrors } from "./errors.js";
import { startInp } from "./inp.js";
import { startInteractions } from "./interactions.js";
import { watchNavigation } from "./navigation.js";
import { startNetwork } from "./network.js";
import { startPageviews } from "./pageview.js";
import { startPlugins } from "./plugins.js";
import { createSessionContext, setPersistence } from "./session.js";
import { createTracer } from "./tracer.js";
import type { CaptureSignal, EverrClient, InitOptions } from "./types.js";
import { SDK_NAME, SDK_VERSION } from "./version.js";
import { startWebVitals } from "./webvitals.js";

export function init(options: InitOptions): EverrClient {
  // Structural no-op: a keyless production build builds no emitter and no
  // watcher, so nothing can ever issue a network request. identify()/
  // setAttributes() still write their in-memory sets, which nothing reads.
  const transport = resolveTransport(options);
  if (!transport) return INERT;

  // Identity (visitor id, 30-minute-inactivity session) runs over the store
  // the persistence option picks: localStorage (the default) is read back
  // across reloads and tabs; memory dies with the page. The event schema is
  // identical either way; identify()'s user.* keys ride the ambient set.
  setPersistence(options.persistence);

  const [rotate, current] = createSessionContext(
    location.href,
    document.referrer,
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
    createEnvelope(current, attributionAttributes(location.search)),
  );
  // The one binding of the package-level surfaces (logger, captureError) to
  // this pipeline; they sample it per call from current.ts.
  const unbindEmit = bindEmit(emit);

  // Plugins set up after identity resolution and before the first built-in
  // capture, in array order; each teardown runs in shutdown() below, in
  // reverse order, before the base capture unpatches.
  const stopPlugins = startPlugins(
    options.plugins,
    emit,
    createTracer(emitSpan),
    options.dev === true,
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
  // on whenever the SDK emits at all. The reporter and the custom logger
  // both ride the current.ts binding; this only adds the global listeners.
  const stopErrors = startErrors();

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
      stopPlugins();
      unbindEmit();
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

const INERT: EverrClient = { flush: noop, shutdown: noop };
