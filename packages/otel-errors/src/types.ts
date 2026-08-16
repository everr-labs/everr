import type { Attributes } from "@opentelemetry/api";

/**
 * The method that sent the error to this package. A manual capture has no
 * mechanism: the record then carries no "everr.error.mechanism" attribute,
 * and its absence means manual. The union contains the names that this
 * package makes, and thus an editor can complete them. The `(string & {})`
 * part lets the other SDKs that use the core client send their own names
 * without a cast. For example, @everr/otel-web reports `onerror` and `react`.
 * Thus a closed type in a Node package does not contain the mechanisms of a
 * browser SDK.
 */
export type Mechanism =
  | "uncaughtException"
  | "unhandledrejection"
  | (string & {});

export type ErrorSeverity = "error" | "fatal";

export interface ErrorEvent {
  error: unknown;
  message: string;
  /**
   * The normalized error that becomes the `exception.*` attributes of the
   * record. A `beforeSend` hook rewrites these fields to redact the record,
   * with no need to mutate the original Error. A `stacktrace` set to
   * `undefined` removes the attribute from the record.
   */
  exception: {
    type: string;
    message: string;
    stacktrace?: string;
  };
  severity: ErrorSeverity;
  /** Absent for a manual capture. The record then carries no
   * "everr.error.mechanism" attribute. */
  mechanism?: Mechanism;
  /** The attributes from the caller that are attached to this error. */
  context: Attributes;
}

/**
 * The configuration of the shared client. The `configure` function applies it.
 * All the fields are optional, and each call merges them. A key that is not
 * present keeps its current value. A key that is present replaces the full
 * field. The merge is not deep.
 *
 * In a merge, a value of `undefined` is the same as a key that is not present.
 * Thus a caller sends `null` to remove a hook that it installed.
 *
 * This package removes no data and it discards no record. It sends the
 * message, the stack, and the attributes from the caller without a change, and
 * it sends one record for each call. The hook is the one place to remove data
 * or to discard a record, and it is the responsibility of the application. This
 * is the same division as in the other browser SDKs and Node SDKs: the SDK
 * carries the data, and a hook, the collector, or the ingest applies the policy
 * of the application.
 */
export interface ClientOptions {
  /**
   * Runs on each log record, before the client sends it. It discards the event
   * if it returns null. If not, it can change the message, the attributes, and
   * the `exception` fields that become the `exception.*` attributes of the
   * record.
   *
   * The hook does not change the active span. When a span is active, the
   * client marks it with `recordException` and `setStatus`, and it takes the
   * values from the error itself and not from the result of this hook. Thus a
   * hook that removes data from the record does not remove it from the span.
   * Use a span processor of the app, the collector, or the ingest for the span.
   * A hook that returns null discards the record and the marking together,
   * because the client stops before both of them.
   */
  beforeSend?: ((event: ErrorEvent) => ErrorEvent | null) | null;
}
