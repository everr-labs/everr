import type { Attributes } from "@opentelemetry/api";
import type { CollectBehavior } from "./redact.js";

/**
 * The method that sent the error to this package. The union contains the three
 * names that this package makes, and thus an editor can complete them. The
 * `(string & {})` part lets the other SDKs that use the core client send their
 * own names without a cast. For example, @everr/otel-web reports `onerror` and
 * `react`. Thus a closed type in a Node package does not contain the
 * mechanisms of a browser SDK.
 */
export type Mechanism =
  | "uncaughtException"
  | "unhandledrejection"
  | "manual"
  | (string & {});

export type ErrorSeverity = "error" | "fatal";

export interface ErrorEvent {
  error: unknown;
  message: string;
  severity: ErrorSeverity;
  mechanism: Mechanism;
  /** The attributes from the caller that are attached to this error. */
  context: Attributes;
}

/**
 * The configuration of the shared client. The `configure` function applies it.
 * All the fields are optional, and each call merges them. A key that is not
 * present keeps its current value. A key that is present replaces the full
 * field. The merge is not deep. Thus a `redactPatterns` array is the full set,
 * and the client does not add it to the previous array.
 *
 * Each field has its own value that stops the function: `rateLimit: false`,
 * `redactPatterns: []`, and `redactKeys: false`. The `beforeSend` field is
 * different. In a merge, a value of `undefined` is the same as a key that is
 * not present. Thus a caller sends `null` to remove a hook that it installed.
 */
export interface ClientOptions {
  /** Discards the event if it returns null. If not, it can change the event. */
  beforeSend?: ((event: ErrorEvent) => ErrorEvent | null) | null;
  redactPatterns?: RegExp[];
  redactKeys?: CollectBehavior;
  /** The limit for each fingerprint. `false` stops it. The default is 5 in 5 s. */
  rateLimit?: { count: number; windowMs: number } | false;
}
