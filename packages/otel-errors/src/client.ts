import {
  type Attributes,
  context,
  diag,
  type Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { type Logger, logs, SeverityNumber } from "@opentelemetry/api-logs";
import { type NormalizedError, normalizeError } from "./normalize.js";
import { RateLimiter } from "./rate-limit.js";
import {
  type CollectBehavior,
  DEFAULT_REDACT_PATTERNS,
  redactAttributeKeys,
  redactAttributes,
  redactString,
} from "./redact.js";
import type {
  ClientOptions,
  ErrorEvent,
  ErrorSeverity,
  Mechanism,
} from "./types.js";
import { PKG_NAME, PKG_VERSION } from "./version.js";

export interface CaptureInput {
  error: unknown;
  mechanism: Mechanism;
  severity?: ErrorSeverity;
  message?: string;
  /** Caller-supplied attributes, merged under the `exception.*` set. */
  context?: Attributes;
}

/**
 * The runtime-neutral capture path: normalize, redact, rate limit, mark the
 * active span, emit one log record. It holds no process or DOM state, so any
 * runtime can drive it.
 *
 * The class is deliberately not exported from either package entry: one
 * instance per process is the contract, and `capture.ts` owns it. It stays a
 * class rather than module state so the tests can exercise the capture path
 * against isolated instances.
 */
export class Client {
  private options: ClientOptions = {};
  private logger: Logger;
  private rateLimiter: RateLimiter | null;
  private redactPatterns: RegExp[] = DEFAULT_REDACT_PATTERNS;
  private redactKeys: CollectBehavior = true;
  private processing = false;

  constructor(options: ClientOptions = {}) {
    // Falls back to the global API registry, which is a no-op logger until
    // an SDK registers. setLogger swaps in an SDK-injected one.
    this.logger = logs.getLogger(PKG_NAME, PKG_VERSION);
    // The default limiter, replaced by configure() only when the caller
    // states a rateLimit of its own.
    this.rateLimiter = new RateLimiter(5, 5000);
    this.configure(options);
  }

  /**
   * Merges options over the current configuration. An absent key keeps its
   * current value, so a caller that re-states one field never resets the
   * others to their defaults. The rate limiter is rebuilt only when
   * `rateLimit` is present, because rebuilding drops the accumulated
   * per-fingerprint windows.
   */
  configure(options: ClientOptions): void {
    // `undefined` counts as absent everywhere, including when it is passed
    // explicitly: a caller forwarding an optional config
    // (`configure({ beforeSend: cfg.beforeSend })`) must not uninstall a hook
    // or restart the rate-limit windows just because its own field is unset.
    // That is what `beforeSend: null` is for. A plain spread would not hold
    // this line, so the merge is a filtered copy.
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) {
        (this.options as Record<string, unknown>)[key] = value;
      }
    }
    // Rebuilt only on an explicit rateLimit, because a rebuild drops the
    // accumulated per-fingerprint windows.
    if (options.rateLimit !== undefined) {
      const rateLimit = options.rateLimit;
      this.rateLimiter =
        rateLimit === false
          ? null
          : new RateLimiter(rateLimit.count, rateLimit.windowMs);
    }
    if (options.redactPatterns !== undefined) {
      this.redactPatterns = options.redactPatterns;
    }
    if (options.redactKeys !== undefined) {
      this.redactKeys = options.redactKeys;
    }
  }

  /** Binds emission to a specific provider's logger instead of the global. */
  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  capture(input: CaptureInput): void {
    // Reentrancy guard: an error thrown inside process() must not recurse
    // through the global handlers back into capture().
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      this.process(input);
    } catch (err) {
      diag.error(`${PKG_NAME}: capture failed`, err);
    } finally {
      this.processing = false;
    }
  }

  private process(input: CaptureInput): void {
    const errorTime = Date.now();
    const normalized = normalizeError(input.error);
    const dedupKey = `${normalized.type}|${normalized.message}|${normalized.topFrame ?? ""}`;

    if (this.rateLimiter && !this.rateLimiter.allow(dedupKey, errorTime)) {
      return;
    }

    let event: ErrorEvent | null = {
      error: input.error,
      message:
        input.message ??
        (normalized.message
          ? `${normalized.type}: ${normalized.message}`
          : normalized.type),
      severity: input.severity ?? "error",
      mechanism: input.mechanism,
      context: input.context ?? {},
    };

    if (this.options.beforeSend) {
      event = this.options.beforeSend(event);
      if (!event) {
        return;
      }
    }

    const errorId = generateErrorId();
    const rawAttributes: Attributes = {
      ...event.context,
      "exception.type": normalized.type,
      "exception.message": normalized.message,
      ...(normalized.stacktrace
        ? { "exception.stacktrace": normalized.stacktrace }
        : {}),
      "everr.error.mechanism": event.mechanism,
    };
    const filteredAttributes = redactAttributeKeys(
      rawAttributes,
      this.redactKeys,
    );
    const attributes = {
      ...redactAttributes(filteredAttributes, this.redactPatterns),
      // The uid is a library-generated identifier, never user data, so it's set
      // after redaction: a numeric-heavy UUID would otherwise trip the
      // credit-card pattern and get partially redacted to "[Filtered]".
      "log.record.uid": errorId,
    };
    const body = redactString(event.message, this.redactPatterns);
    const activeSpan = trace.getActiveSpan();

    // Attach the error to the surrounding span so traces show the failure.
    // A browser SDK usually has no active span, in which case this is a no-op.
    if (activeSpan) {
      markActiveSpan(activeSpan, normalized, input.error);
    }

    this.logger.emit({
      eventName: "exception",
      severityNumber: severityNumber(event.severity),
      severityText: event.severity.toUpperCase(),
      body,
      attributes,
      exception: input.error,
      context: context.active(),
    });
  }
}

function markActiveSpan(
  span: Span,
  normalized: NormalizedError,
  error: unknown,
): void {
  span.recordException(
    error instanceof Error
      ? error
      : { name: normalized.type, message: normalized.message },
  );
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: normalized.message
      ? `${normalized.type}: ${normalized.message}`
      : normalized.type,
  });
}

function severityNumber(severity: ErrorSeverity): SeverityNumber {
  return severity === "fatal" ? SeverityNumber.FATAL : SeverityNumber.ERROR;
}

function generateErrorId(): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }

  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}
