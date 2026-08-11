import type { HostSend } from "./config.js";
import type { BeforeSend } from "./emitter.js";
import type { Instrumentation } from "./instrumentations/runtime.js";

/**
 * The location of the identity: the visitor id, the session, and the
 * identified user.
 *
 * - `"localStorage"` is the default. It keeps a random visitor id
 *   (`everr.visitor.id`), which is an id for the device. The code never
 *   calculates it from a fingerprint. The sessions end after 30 minutes
 *   without activity. The ids and the sessions continue after a reload, and
 *   all the tabs use them. The data from `identify()` stays until a call to
 *   `revoke()`.
 * - `"memory"` uses no cookies and no store. The same ids stay in JS memory
 *   only. They continue during an SPA navigation. They end at a reload or when
 *   the user closes the tab. The data from `identify()` stays for the life of
 *   the page.
 *
 * The host controls the consent, and the SDK does not. An app with a CMP starts
 * with `"memory"` until the user gives consent. Then it calls
 * `setPersistence("localStorage")` on the current client. The `revoke()`
 * function goes back to `"memory"`. The event schema is the same for the two
 * values. The persistence only changes the life of the ids.
 */
export type Persistence = "localStorage" | "memory";

export type WebSDKOptions = {
  /** The `service.name` resource attribute on the events. */
  serviceName: string;
  /** Replaces the `service.version` resource attribute. The default is the
   * build version of the SDK. */
  serviceVersion?: string;
  /**
   * The `service.instance.id` resource attribute. It gives the installation or
   * the process of `serviceName`. When the app does not set it, the resource
   * does not contain it. This is the correct default for a web page, because a
   * different instance for each page load has no value. A desktop host or a
   * kiosk host that has a permanent installation id must set it.
   */
  serviceInstanceId?: string;
  /** The `deployment.environment.name` resource attribute, for example
   * `import.meta.env.MODE`. */
  deploymentEnvironment?: string;
  /**
   * The ingest key. When the app sets it, and the app gives no `endpoint`, the
   * SDK sends the events to the hosted Everr ingest. In the browser, use the
   * public key for one origin. In server code, that is a WebSDK that SSR
   * constructs, you must use a secret key. The hosted ingest refuses a public
   * key on a request that has no origin.
   */
  ingestKey?: string;
  /** An OTLP base endpoint that replaces the default. It carries the header of
   * the ingest key when the app sets a key. */
  endpoint?: string;
  /**
   * Sends the data in place of the SDK. The SDK calls it with one OTLP/JSON
   * payload for each signal, and it does not do a fetch POST. Then the SDK does
   * not use `ingestKey`, `endpoint`, and `dev`, and it makes no request. Use
   * this in a host that sends the telemetry itself, for example a Tauri
   * renderer or an Electron renderer that gives the bytes to its native part:
   *
   * ```ts
   * new WebSDK({ send: (signal, body) => invoke("proxy_otlp", { signal, body }) })
   * ```
   *
   * The SDK tries to send the data, but it accepts a failure. If `send` throws
   * an error or rejects, the SDK ignores that error. A failure of fetch is the
   * same. If `send` returns a promise, `flush()` waits for it. The host
   * controls the transport. Thus the keepalive limit in bytes of the browser
   * does not apply, and the flush at exit sends the full batch.
   */
  send?: HostSend;
  /**
   * The development mode, for example `import.meta.env.DEV`. Without a key and
   * without an endpoint, a development build uses the local collector. A
   * production build then makes no structure and no network request.
   */
  dev?: boolean;
  /** The life of the identity ids. Refer to {@link Persistence}. You can change
   * it later with `setPersistence()`. */
  persistence?: Persistence;
  /**
   * The sources of the capture. The constructor starts them in the sequence of
   * the array, after it finds the identity. The `shutdown()` function stops
   * them in the opposite sequence.
   *
   * You must select the capture. A WebSDK without this option connects the
   * pipeline, the transport, and the identity, but it captures nothing. Use the
   * built-in functions `errors()`, `pageviews()`, `interactions()`,
   * `performance()`, and `network()`, and add your own instrumentations. The
   * server accepts this option but ignores it.
   */
  instrumentations?: Instrumentation[];
  /**
   * Runs on each log record and on each span, immediately before the SDK puts
   * the item in its queue. It discards the item if it returns null. If not, it
   * can change the item. The `kind` field selects the type: `"log"` or
   * `"span"`.
   *
   * The attributes contain the envelope of the SDK. Thus the hook sees
   * `url.full`, the route, and the identity keys on all the signals, and a
   * policy on an attribute has one place:
   *
   * ```ts
   * new WebSDK({
   *   beforeSend: (item) => {
   *     const url = item.attributes["url.full"];
   *     if (typeof url === "string")
   *       item.attributes["url.full"] = url.split("?")[0];
   *     return item;
   *   },
   * })
   * ```
   *
   * The SDK removes no data on its own, and thus this hook is the one place to
   * apply the policy of your application. It also operates on the server entry,
   * and thus an isomorphic `logger` call has the same result in the two module
   * graphs.
   */
  beforeSend?: BeforeSend;
};

/**
 * The traits for identify(). The SDK writes them on the subsequent events as
 * `user.*` attributes. Use single values only, the same as in setAttributes.
 * Put the dots in the key yourself to make a structure, for example
 * `"company.name"`. A value of `null` removes nothing, because each call to
 * identify replaces all the `user.*` keys.
 */
export type UserTraits = Record<string, string | number | boolean | null>;
