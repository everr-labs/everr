import type { Attributes } from "@opentelemetry/api";
import type { CollectBehavior } from "./redact.js";

/**
 * How the error reached us. The three names this package produces stay in the
 * union for completions; the `(string & {})` arm lets other SDKs built on the
 * core Client (notably @everr/otel-web, which reports `onerror` and `react`)
 * pass their own vocabulary uncast, rather than encoding a browser SDK's
 * mechanisms in a Node package's closed type.
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
  /** The caller-supplied attributes attached to this error. */
  context: Attributes;
}

/**
 * The shared client's configuration, applied through `configure`. Every field
 * is optional and every call merges: an absent key keeps its current value, a
 * present one replaces that field wholesale. There is no deep merge, so a
 * `redactPatterns` array is the whole set and never a union with the last one.
 *
 * Each field carries its own "off" value (`rateLimit: false`,
 * `redactPatterns: []`, `redactKeys: false`). `beforeSend` is the exception:
 * `undefined` is indistinguishable from absent under a merge, so `null` is
 * how a caller removes a hook it installed.
 */
export interface ClientOptions {
  /** Drops the event when it returns null, or rewrites it in place. */
  beforeSend?: ((event: ErrorEvent) => ErrorEvent | null) | null;
  redactPatterns?: RegExp[];
  redactKeys?: CollectBehavior;
  /** Per-fingerprint throttle. `false` disables it. Defaults to 5 per 5s. */
  rateLimit?: { count: number; windowMs: number } | false;
}
