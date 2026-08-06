import type { Plugin } from "./plugins/runtime.js";

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
  /** How long identity ids live; see {@link Persistence}. Fixed at init. */
  persistence?: Persistence;
  /**
   * The capture sources, set up during init (in order, after identity
   * resolution) and torn down by `shutdown()` (in reverse order). Capture is
   * opt-in only: a bare init wires pipeline, transport, and identity and
   * captures nothing; compose the built-in factories (`errors()`,
   * `pageviews()`, `interactions()`, `performance()`, `network()`) alongside
   * any custom plugins. Accepted and ignored on the server.
   */
  plugins?: Plugin[];
};

/**
 * identify() traits: stamped onto subsequent events as `user.*` attributes.
 * Flat scalars only, same contract as setAttributes; dot the keys yourself
 * for structure (`"company.name"`). A `null` clears nothing (the whole
 * namespace is replaced per identify anyway).
 */
export type UserTraits = Record<string, string | number | boolean | null>;

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
