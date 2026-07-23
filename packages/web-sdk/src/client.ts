import { attributionAttributes } from "./attribution.js";
import { resolveTransport } from "./config.js";
import { createEmitter, noop } from "./emitter.js";
import { createEnvelope } from "./envelope.js";
import { startInteractions } from "./interactions.js";
import { watchNavigation } from "./navigation.js";
import { startPageviews } from "./pageview.js";
import { createSessionContext } from "./session.js";
import type {
  CaptureSignal,
  ConsentedClient,
  ConsentedInitOptions,
  CookielessClient,
  CookielessInitOptions,
  EverrClient,
  InitOptions,
} from "./types.js";

declare const __PACKAGE_VERSION__: string | undefined;
const SDK_VERSION =
  typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev";
const SDK_NAME = "@everr/web-sdk";

export function init(options: CookielessInitOptions): CookielessClient;
export function init(options: ConsentedInitOptions): ConsentedClient;
export function init(options: InitOptions): EverrClient {
  if (options.mode === "consented") {
    throw new Error(
      '[@everr/web-sdk] mode "consented" is not implemented yet; use mode "cookieless".',
    );
  }

  // SSR guard: the SDK is browser-only; server renders get an inert client.
  if (typeof window === "undefined") return INERT;

  // Structural no-op: a keyless production build builds no emitter and no
  // watcher, so nothing can ever issue a network request.
  const transport = resolveTransport(options);
  if (!transport) return INERT;

  const session = createSessionContext(location.href, document.referrer);

  const emitter = createEmitter({
    ...transport,
    scope: { name: SDK_NAME, version: SDK_VERSION },
    envelope: createEnvelope(session, attributionAttributes(location.search)),
    // Viewport is deliberately absent: it changes on resize, so it rides
    // the click payload per event instead of being frozen into the
    // resource.
    resource: {
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
  });

  // The navigation watcher always runs so the envelope's page context stays
  // fresh for every signal; the disable list only gates the signal listeners.
  const off = options.disable;
  const enabled = (signal: CaptureSignal) =>
    off !== true && !off?.includes(signal);
  const pageviews = enabled("pageviews")
    ? startPageviews(emitter, session)
    : undefined;
  const stopWatching = watchNavigation(
    session,
    pageviews ? [pageviews.onNavigate] : [],
  );
  const stopInteractions = enabled("interactions")
    ? startInteractions(emitter)
    : undefined;

  // Exit delivery: the final leave plus whatever is batched rides the
  // keepalive path. pagehide and visibilitychange-hidden, not beforeunload
  // (which never fires on mobile and breaks bfcache).
  const onHide = () => {
    pageviews?.onHide();
    emitter.exitFlush();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") onHide();
  };
  addEventListener("pagehide", onHide);
  addEventListener("visibilitychange", onVisibilityChange);

  return {
    flush: emitter.flush,
    shutdown: () => {
      removeEventListener("pagehide", onHide);
      removeEventListener("visibilitychange", onVisibilityChange);
      stopInteractions?.();
      pageviews?.stop();
      stopWatching();
      return emitter.shutdown();
    },
  };
}

const INERT: EverrClient = { flush: noop, shutdown: noop };
