import { attributionAttributes } from "./attribution.js";
import { resolveCapture } from "./capture.js";
import { resolveTransport } from "./config.js";
import { createEmitter } from "./emitter.js";
import { createEnvelope } from "./envelope.js";
import { type NavigationListener, watchNavigation } from "./navigation.js";
import type { AttrValue } from "./otlp.js";
import { startPageviews } from "./pageview.js";
import { SessionContext } from "./session.js";
import type {
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

/** Test seam: inject a fetch to capture the OTLP payloads. */
export type InitOverrides = {
  transportFetch?: typeof fetch;
};

export function init(options: CookielessInitOptions): CookielessClient;
export function init(options: ConsentedInitOptions): ConsentedClient;
export function init(options: InitOptions): EverrClient {
  return initInternal(options);
}

export function initInternal(
  options: InitOptions,
  overrides?: InitOverrides,
): EverrClient {
  if (options.mode === "consented") {
    throw new Error(
      '[@everr/web-sdk] mode "consented" is not implemented yet; use mode "cookieless".',
    );
  }

  // SSR guard: the SDK is browser-only; server renders get an inert client.
  if (typeof window === "undefined") return inertClient(options.mode);

  // Structural no-op: a keyless production build builds no emitter and no
  // watcher, so nothing can ever issue a network request.
  const transport = resolveTransport(options);
  if (!transport) return inertClient(options.mode);

  const capture = resolveCapture(options.capture);
  const session = new SessionContext(
    window.location.href,
    document.referrer || undefined,
  );

  const emitter = createEmitter({
    logsUrl: transport.logsUrl,
    headers: transport.headers,
    resource: resourceAttributes(options),
    scope: { name: SDK_NAME, version: SDK_VERSION },
    envelope: createEnvelope(
      session,
      attributionAttributes(window.location.href),
    ),
    transportFetch: overrides?.transportFetch,
  });

  // The navigation watcher always runs so the envelope's page context stays
  // fresh for every signal; capture flags only gate the signal listeners.
  const navigationListeners: NavigationListener[] = [];
  if (capture.pageviews) {
    navigationListeners.push(startPageviews(emitter));
  }
  const stopWatching = watchNavigation(session, navigationListeners);

  return {
    mode: options.mode,
    flush: () => emitter.flush(),
    shutdown: async () => {
      stopWatching();
      await emitter.shutdown();
    },
  };
}

function resourceAttributes(options: InitOptions): Record<string, AttrValue> {
  // Viewport is deliberately absent: it changes on resize, so it rides the
  // click payload per event instead of being frozen into the resource.
  return {
    "service.name": options.serviceName,
    "service.namespace": "everr",
    "service.version": options.serviceVersion ?? SDK_VERSION,
    ...(options.deploymentEnvironment
      ? { "deployment.environment.name": options.deploymentEnvironment }
      : {}),
    "everr.sdk.name": SDK_NAME,
    "everr.sdk.version": SDK_VERSION,
    "user_agent.original": navigator.userAgent,
    "everr.screen.width": window.screen.width,
    "everr.screen.height": window.screen.height,
    "everr.timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
    "everr.language": navigator.language,
  };
}

function inertClient(mode: InitOptions["mode"]): EverrClient {
  return {
    mode,
    flush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}
