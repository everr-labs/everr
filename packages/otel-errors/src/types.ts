import type { Attributes } from "@opentelemetry/api";
import type { CollectBehavior } from "./scrub.js";

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

export type ErrorSeverity = "debug" | "info" | "warn" | "error" | "fatal";

export interface ErrorEvent {
  error: unknown;
  message: string;
  severity: ErrorSeverity;
  mechanism: Mechanism;
  handled: boolean;
  attributes: Attributes;
}

export interface Options {
  /** Drops the event when it returns null, or rewrites it in place. */
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
  redactPatterns?: RegExp[];
  redactKeys?: CollectBehavior;
  /** Per-fingerprint throttle. `false` disables it. Defaults to 5 per 5s. */
  rateLimit?: { count: number; windowMs: number } | false;
  /**
   * What to do after a fatal error is flushed. "exit" (the default) restores
   * the crash Node would have performed had no listener been installed;
   * "continue" leaves the process running.
   */
  onFatal?: "exit" | "continue";
}
