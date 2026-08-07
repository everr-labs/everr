import { attributionAttributes } from "./attribution.js";
import { resolveTransport } from "./config.js";
import { bindEmit } from "./current.js";
import { createEmitter, noop } from "./emitter.js";
import { createEnvelope } from "./envelope.js";
import { type NavigationListener, watchNavigation } from "./navigation.js";
import type { PluginContext } from "./plugins/runtime.js";
import { routePattern } from "./route.js";
import {
  createSessionContext,
  sessionId,
  setPersistence,
  visitorId,
} from "./session.js";
import { createTracer } from "./tracer.js";
import type { EverrClient, InitOptions } from "./types.js";
import { SDK_NAME, SDK_VERSION } from "./version.js";

export function init(options: InitOptions): EverrClient {
  // Structural no-op: a keyless production build builds no emitter and no
  // watcher, so nothing can ever issue a network request. identify()/
  // setAttributes() still write their in-memory sets, which nothing reads.
  const transport = resolveTransport(options);
  if (!transport) return INERT;

  // Capture is opt-in only: without plugins the base still wires pipeline,
  // transport, and identity, so logger and captureError work, but nothing is
  // captured automatically. That is a legitimate composition, not a
  // misconfiguration.

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
      ...attributionAttributes(location.search),
    },
    { name: SDK_NAME, version: SDK_VERSION },
    createEnvelope(current),
  );
  // The one binding of the package-level surfaces (logger, captureError) to
  // this pipeline; they sample it per call from current.ts.
  const unbindEmit = bindEmit(emit);

  // Plugins are the only capture sources, set up after identity resolution
  // in array order; each teardown runs in shutdown() below, in reverse
  // order, before the pipeline unbinds. One context serves every plugin:
  // ids, route, and page sample the live module state directly. The
  // navigation listener list is live: the watcher below iterates it per
  // navigation, so ctx.onNavigation subscriptions from any plugin land in
  // the same dispatch.
  const navigationListeners = new Set<NavigationListener>();
  const ctx: PluginContext = {
    emit,
    tracer: createTracer(emitSpan),
    ids: () => ({ visitorId: visitorId(), sessionId: sessionId() }),
    route: () => routePattern() ?? null,
    page: current,
    onNavigation: (listener) => {
      navigationListeners.add(listener);
      return () => {
        navigationListeners.delete(listener);
      };
    },
    dev: options.dev === true,
  };

  const teardowns = (options.plugins ?? []).map((plugin) => plugin(ctx));

  // The navigation watcher is envelope infrastructure, not a signal: it
  // always runs so the page context stays fresh for every record, whether or
  // not any plugin subscribed.
  const stopWatching = watchNavigation(rotate, navigationListeners);

  // Exit delivery: whatever is batched (including plugin hide-path records,
  // whose listeners registered earlier and so ran first) rides the keepalive
  // path. pagehide and visibilitychange-hidden, not beforeunload (which
  // never fires on mobile and breaks bfcache).
  const onHide = () => {
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
      // Reverse setup order, before the pipeline unbinds.
      for (let i = teardowns.length - 1; i >= 0; i--) teardowns[i]?.();
      unbindEmit();
      stopWatching();
      return flush();
    },
  };
}

const INERT: EverrClient = { flush: noop, shutdown: noop };
