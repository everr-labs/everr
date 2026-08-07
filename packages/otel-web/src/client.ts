import { attributionAttributes } from "./attribution.js";
import { resolveTransport } from "./config.js";
import { bindEmit } from "./current.js";
import { createEmitter, noop } from "./emitter.js";
import { createEnvelope } from "./envelope.js";
import type { InstrumentationContext } from "./instrumentations/runtime.js";
import { type NavigationListener, watchNavigation } from "./navigation.js";
import { routePattern } from "./route.js";
import {
  createSessionContext,
  sessionId,
  setPersistence,
  visitorId,
} from "./session.js";
import { createTracer } from "./tracer.js";
import type { WebSDKOptions } from "./types.js";
import { SDK_NAME, SDK_VERSION } from "./version.js";

/**
 * The browser SDK: constructing it wires transport, identity, and the
 * configured instrumentations, exactly once, with no separate start step.
 * Identity capabilities (`identify()`, `revoke()`) are package-level
 * functions instead of instance methods, exactly like `captureError()` and
 * `logger`, so the instance shape never depends on the options.
 */
export class WebSDK {
  /** Force-flushes any batched records. */
  flush: () => Promise<void>;
  /** Flushes, stops all capture, and unpatches globals. */
  shutdown: () => Promise<void>;

  constructor(options: WebSDKOptions) {
    // Structural no-op: a keyless production build builds no emitter and no
    // watcher, so nothing can ever issue a network request. identify()/
    // setAttributes() still write their in-memory sets, which nothing reads.
    const transport = resolveTransport(options);
    if (!transport) {
      this.flush = noop;
      this.shutdown = noop;
      return;
    }

    // Capture is opt-in only: without instrumentations the base still wires pipeline,
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
        "service.instance.id": options.serviceInstanceId,
        "deployment.environment.name": options.deploymentEnvironment,
        "telemetry.distro.name": SDK_NAME,
        "telemetry.distro.version": SDK_VERSION,
        "user_agent.original": navigator.userAgent,
        "everr.screen.width": screen.width,
        "everr.screen.height": screen.height,
        "everr.timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
        "browser.language": navigator.language,
        // Browsers pin web vitals to the initial hard navigation while the
        // envelope's url.* rotate with SPA navigations; the landing url is
        // fixed for the client's life, so it rides the resource like the UTM
        // attribution derived from its query string.
        "everr.landing.url": location.href,
        "everr.landing.path": location.pathname,
        ...attributionAttributes(location.search),
      },
      { name: SDK_NAME, version: SDK_VERSION },
      createEnvelope(current),
    );
    // The one binding of the package-level surfaces (logger, captureError) to
    // this pipeline; they sample it per call from current.ts.
    const unbindEmit = bindEmit(emit);

    // Instrumentations are the only capture sources, set up after identity resolution
    // in array order; each teardown runs in shutdown() below, in reverse
    // order, before the pipeline unbinds. One context serves every instrumentation:
    // ids, route, and page sample the live module state directly. The
    // navigation listener list is live: the watcher below iterates it per
    // navigation, so ctx.onNavigation subscriptions from any instrumentation land in
    // the same dispatch.
    const navigationListeners = new Set<NavigationListener>();
    const ctx: InstrumentationContext = {
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

    const teardowns = (options.instrumentations ?? []).map((instrumentation) =>
      instrumentation(ctx),
    );

    // The navigation watcher is envelope infrastructure, not a signal: it
    // always runs so the page context stays fresh for every record, whether or
    // not any instrumentation subscribed.
    const stopWatching = watchNavigation(rotate, navigationListeners);

    // Exit delivery: whatever is batched (including instrumentation hide-path records,
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

    this.flush = flush;
    this.shutdown = () => {
      removeEventListener("pagehide", onHide);
      removeEventListener("visibilitychange", onVisibilityChange);
      // Reverse setup order, before the pipeline unbinds.
      for (let i = teardowns.length - 1; i >= 0; i--) teardowns[i]?.();
      unbindEmit();
      stopWatching();
      return flush();
    };
  }
}
