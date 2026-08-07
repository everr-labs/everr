import type { HostSend } from "./config.js";
import type { Instrumentation } from "./instrumentations/runtime.js";

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
 * with `"memory"` until consent is granted, then constructs a new WebSDK with
 * `"localStorage"`. The event schema is identical either way; persistence
 * only changes how long the ids live.
 */
export type Persistence = "localStorage" | "memory";

export type WebSDKOptions = {
  /** The `service.name` resource attribute events are reported under. */
  serviceName: string;
  /** Overrides the `service.version` resource attribute (defaults to the SDK build version). */
  serviceVersion?: string;
  /**
   * The `service.instance.id` resource attribute: which install or process
   * of `serviceName` this is. Omitted from the resource when unset, which is
   * the right default for a web page (one instance per load is not useful);
   * a desktop or kiosk host that has a durable install id should set it.
   */
  serviceInstanceId?: string;
  /** The `deployment.environment.name` resource attribute, e.g. `import.meta.env.MODE`. */
  deploymentEnvironment?: string;
  /**
   * Ingest key. When set (and no explicit `endpoint` is given) events ship
   * to the hosted Everr ingest. In the browser this is the public
   * origin-bound key; in server code (an SSR-constructed WebSDK) it must be a secret key,
   * since the hosted ingest denies public keys on origin-less requests.
   */
  ingestKey?: string;
  /** Explicit OTLP base endpoint override (carries the ingest key's header when one is set). */
  endpoint?: string;
  /**
   * Takes over delivery. Called with one OTLP/JSON payload per signal, in
   * place of the SDK's fetch POST; `ingestKey`, `endpoint`, and `dev` are
   * then unused, and the SDK never issues a request of its own. For hosts
   * that proxy telemetry themselves, e.g. a Tauri or Electron renderer
   * handing the bytes to its native side:
   *
   * ```ts
   * new WebSDK({ send: (signal, body) => invoke("proxy_otlp", { signal, body }) })
   * ```
   *
   * Delivery stays best-effort: a throwing or rejecting `send` is swallowed,
   * exactly as a failed fetch is. Returning a promise makes `flush()` await
   * it. Because the host owns transport, the browser keepalive byte budget
   * does not apply and the exit flush ships the whole batch.
   */
  send?: HostSend;
  /**
   * Development mode, e.g. `import.meta.env.DEV`. Without a key or endpoint,
   * dev falls back to the local collector; production becomes a structural
   * no-op that never issues a network request.
   */
  dev?: boolean;
  /** How long identity ids live; see {@link Persistence}. Fixed at construction. */
  persistence?: Persistence;
  /**
   * The capture sources, set up during construction (in order, after
   * identity resolution) and torn down by `shutdown()` (in reverse order).
   * Capture is opt-in only: a bare WebSDK wires pipeline, transport, and identity and
   * captures nothing; compose the built-in factories (`errors()`,
   * `pageviews()`, `interactions()`, `performance()`, `network()`) alongside
   * any custom instrumentations. Accepted and ignored on the server.
   */
  instrumentations?: Instrumentation[];
};

/**
 * identify() traits: stamped onto subsequent events as `user.*` attributes.
 * Flat scalars only, same contract as setAttributes; dot the keys yourself
 * for structure (`"company.name"`). A `null` clears nothing (the whole
 * namespace is replaced per identify anyway).
 */
export type UserTraits = Record<string, string | number | boolean | null>;
