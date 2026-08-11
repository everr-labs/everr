import { attributionAttributes } from "./attribution.js";
import { resolveTransport } from "./config.js";
import { bindEmit } from "./emit.js";
import { createEmitter, noop } from "./emitter.js";
import { createEnvelope } from "./envelope.js";
import type { InstrumentationContext } from "./instrumentations/runtime.js";
import { type NavigationListener, watchNavigation } from "./navigation.js";
import { routePattern } from "./route.js";
import {
  createSessionContext,
  persistSession,
  sessionId,
  setPersistence,
  visitorId,
} from "./session.js";
import { createTracer } from "./tracer.js";
import type { WebSDKOptions } from "./types.js";
import { SDK_NAME, SDK_VERSION } from "./version.js";

/**
 * The browser SDK. The constructor connects the transport, the identity, and
 * the configured instrumentations one time. There is no separate start step.
 *
 * The identity functions `identify()` and `revoke()` are package functions,
 * not methods on the instance. The `captureError()` function and `logger` are
 * the same. Thus the structure of the instance does not change with the
 * options.
 */
export class WebSDK {
  /** Sends all the records that are in the batch queue. */
  flush: () => Promise<void>;
  /** Sends the records, stops all the capture, and restores the globals. */
  shutdown: () => Promise<void>;

  constructor(options: WebSDKOptions) {
    // The SDK then does nothing. A production build without a key makes no
    // emitter and no watcher. Thus the SDK cannot make a network request. The
    // identify() and setAttributes() functions continue to write their sets in
    // memory, but no code reads those sets.
    const transport = resolveTransport(options);
    if (!transport) {
      this.flush = noop;
      this.shutdown = noop;
      return;
    }

    // The caller must select the capture. Without instrumentations, the SDK
    // still connects the pipeline, the transport, and the identity. Thus
    // logger and captureError operate, but the SDK captures nothing
    // automatically. This is a correct configuration.

    // The identity contains the visitor id and the session, and the session
    // ends after 30 minutes without activity. The identity uses the store that
    // the persistence option selects. The default store is localStorage, and
    // the SDK can read it after a reload and in the other tabs. The memory
    // store ends with the page. The event schema is the same for the two
    // stores. The user.* keys from identify() go into the ambient set.
    setPersistence(options.persistence);

    const [rotate, current] = createSessionContext(
      location.href,
      document.referrer,
    );

    const [emit, flush, exitFlush, emitSpan] = createEmitter(
      ...transport,
      // The resource does not contain the viewport, and this is correct. The
      // viewport changes when the user changes the window size. Thus each
      // click event carries the viewport, and the resource does not hold one
      // constant value.
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
        // A browser calculates the web vitals for the first full navigation.
        // But the url.* keys in the envelope change with each SPA navigation.
        // The landing url does not change during the life of the client. Thus
        // the resource carries it, and the resource also carries the UTM
        // attribution from the query string of that url.
        "everr.landing.url": location.href,
        "everr.landing.path": location.pathname,
        ...attributionAttributes(location.search),
      },
      { name: SDK_NAME, version: SDK_VERSION },
      createEnvelope(current),
      options.beforeSend,
    );
    // This is the only connection of the package functions, logger and
    // captureError, to this pipeline. Each call reads the pipeline from
    // current.ts.
    const unbindEmit = bindEmit(emit);

    // The instrumentations are the only sources of the capture. The SDK starts
    // them after it finds the identity, in the sequence of the array. The
    // shutdown() function below stops each of them in the opposite sequence,
    // before the pipeline disconnects.
    //
    // One context serves all the instrumentations. The ids, the route, and the
    // page read the current module data directly. The list of navigation
    // listeners is dynamic: for each navigation the watcher below reads the
    // full list. Thus a ctx.onNavigation subscription from each instrumentation
    // goes into the same dispatch.
    const navigationListeners = new Set<NavigationListener>();
    const ctx: InstrumentationContext = {
      emit,
      tracer: createTracer(emitSpan),
      ids: () => ({ visitorId: visitorId(), sessionId: sessionId() }),
      route: () => routePattern(current().url) ?? null,
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

    // The navigation watcher is part of the envelope, and it is not a signal.
    // It always operates, and thus the page context is correct for each
    // record. This is true if an instrumentation subscribes, and also if none
    // subscribes.
    const stopWatching = watchNavigation(rotate, navigationListeners);

    // The delivery at exit. All the records in the batch queue go on the
    // keepalive path. This includes the records from the hide path of an
    // instrumentation, because those listeners registered before this one and
    // thus operated first.
    //
    // The SDK uses the pagehide event and the visibilitychange event with the
    // hidden state. It does not use beforeunload, because beforeunload does not
    // occur on a mobile device and it prevents the bfcache.
    const onHide = () => {
      // The write of the activity of the session is on a delay. Thus the code
      // writes it now, while the page can still use the store.
      persistSession();
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
      // The opposite sequence to the setup, before the pipeline disconnects.
      for (let i = teardowns.length - 1; i >= 0; i--) teardowns[i]?.();
      unbindEmit();
      stopWatching();
      return flush();
    };
  }
}
