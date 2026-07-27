/**
 * Analytics signals that can be disabled at init; everything is on by default
 * and only exclusions are named.
 *
 * - `pageviews` governs `browser.page_view` and `browser.page_leave` together.
 * - `interactions` governs rage and dead click detection.
 * - `webVitals` governs `browser.web_vital` reporting.
 *
 * Errors have no signal key (`@everr/auto-otel-errors` options govern them)
 * and replay is never a signal (the mode system owns it).
 */
export type CaptureSignal = "pageviews" | "interactions" | "webVitals";

type CommonInitOptions = {
  /** The `service.name` resource attribute events are reported under. */
  serviceName: string;
  /** Overrides the `service.version` resource attribute (defaults to the SDK build version). */
  serviceVersion?: string;
  /** The `deployment.environment.name` resource attribute, e.g. `import.meta.env.MODE`. */
  deploymentEnvironment?: string;
  /**
   * Public origin-bound browser ingest key. When set (and no explicit
   * `endpoint` is given) events ship to the hosted Everr ingest.
   */
  ingestKey?: string;
  /** Explicit OTLP base endpoint override (carries the ingest key's header when one is set). */
  endpoint?: string;
  /**
   * Development mode, e.g. `import.meta.env.DEV`. Without a key or endpoint,
   * dev falls back to the local collector; production becomes a structural
   * no-op that never issues a network request.
   */
  dev?: boolean;
  /** Signals to turn off; `true` disables all analytics capture. Fixed at init. */
  disable?: true | CaptureSignal[];
  /**
   * Returns the active low-cardinality route pattern (e.g. a TanStack route
   * id like `/blog/$slug`), sampled per record and stamped on the envelope
   * as `everr.route.pattern`, so every signal slices by route, not just by
   * URL. Errors and nullish returns are treated as "no pattern". TanStack
   * apps can wire this with a small app-owned bridge: register the router
   * instance where it is created, and sample the deepest match of
   * `router.state.matches` here.
   */
  routePattern?: () => string | null | undefined;
};

/**
 * Strictly cookieless: zero cookies, zero storage, no visitor id. A random
 * in-memory `session.id` survives SPA navigations and dies on reload or tab
 * close. There are no identity or replay fields on this type by design.
 */
export type CookielessInitOptions = CommonInitOptions & {
  mode: "cookieless";
};

/**
 * Consented mode (post-CMP-opt-in): durable identity, `identify()`, and the
 * lazy replay subpath. Not implemented yet; `init` rejects it at runtime.
 */
export type ConsentedInitOptions = CommonInitOptions & {
  mode: "consented";
};

export type InitOptions = CookielessInitOptions | ConsentedInitOptions;

declare const ModeBrand: unique symbol;

export interface EverrClient {
  /** Force-flushes any batched records. */
  flush(): Promise<void>;
  /** Flushes, stops all capture, and unpatches globals. */
  shutdown(): Promise<void>;
}

/**
 * The mode distinction is a type-only brand (zero runtime bytes): the brand
 * property never exists on the object, it just keeps the two handles
 * mutually unassignable so consented-only capabilities cannot accept a
 * cookieless handle.
 */
export interface CookielessClient extends EverrClient {
  readonly [ModeBrand]?: "cookieless";
}

/**
 * Mode-typed handle for consented deployments. `identify()`, `revoke()`, and
 * the replay capability land on this handle (and only this handle) when
 * consented mode ships.
 */
export interface ConsentedClient extends EverrClient {
  readonly [ModeBrand]?: "consented";
}
