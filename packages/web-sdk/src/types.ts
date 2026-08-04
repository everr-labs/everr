/**
 * Analytics signals that can be disabled at init; everything is on by default
 * and only exclusions are named.
 *
 * - `pageviews` governs `everr.browser.page_view` and
 *   `everr.browser.page_leave` together.
 * - `interactions` governs product-analytics autocapture: every `click` (DOM,
 *   with coordinates), form-field `change`, `submit` (targeting the
 *   submitter button), plus `rage_click` on a frustration burst and
 *   `everr.browser.slow_interaction` from the Event Timing API (entries
 *   above the duration threshold, carrying the native interaction latency).
 * - `webVitals` governs `browser.web_vital` reporting.
 *
 * Errors have no signal key (capture is native, always on, and option-free)
 * and replay is never a signal (it will get its own option when it ships).
 */
export type CaptureSignal = "pageviews" | "interactions" | "webVitals";

/**
 * Where identity (the visitor id, the session, the identified user) lives.
 *
 * - `"localStorage"` (the default): a random persistent visitor id
 *   (`everr.visitor.id`, a device id, never fingerprint-derived) and durable
 *   30-minute-inactivity sessions survive reloads and are shared across
 *   tabs; `identify()` persists until `revoke()`.
 * - `"memory"`: zero cookies, zero storage. The same ids exist only in JS
 *   memory, survive SPA navigations, and die on reload or tab close;
 *   `identify()` works for the life of the page.
 *
 * Consent is the host's call, not the SDK's: a CMP-gated deployment boots
 * with `"memory"` until consent is granted, then re-initializes with
 * `"localStorage"`. The event schema is identical either way; persistence
 * only changes how long the ids live.
 */
export type Persistence = "localStorage" | "memory";

export type InitOptions = {
  /** The `service.name` resource attribute events are reported under. */
  serviceName: string;
  /** Overrides the `service.version` resource attribute (defaults to the SDK build version). */
  serviceVersion?: string;
  /** The `deployment.environment.name` resource attribute, e.g. `import.meta.env.MODE`. */
  deploymentEnvironment?: string;
  /**
   * Ingest key. When set (and no explicit `endpoint` is given) events ship
   * to the hosted Everr ingest. In the browser this is the public
   * origin-bound key; in server code (SSR init) it must be a secret key,
   * since the hosted ingest denies public keys on origin-less requests.
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
  /** How long identity ids live; see {@link Persistence}. Fixed at init. */
  persistence?: Persistence;
};

/**
 * identify() traits: flattened onto subsequent events as dotted `user.*`
 * attributes. Nested objects recurse; scalars only, so arrays are rejected
 * at compile time and nullish leaves are dropped.
 */
export type UserTraits = {
  [key: string]: string | number | boolean | null | undefined | UserTraits;
};

/**
 * The handle returned by `init()`. Identity capabilities (`identify()`,
 * `revoke()`) are package-level functions instead of handle methods, exactly
 * like `captureError()` and `logger`, so the handle shape never depends on
 * the init options.
 */
export interface EverrClient {
  /** Force-flushes any batched records. */
  flush(): Promise<void>;
  /** Flushes, stops all capture, and unpatches globals. */
  shutdown(): Promise<void>;
}
