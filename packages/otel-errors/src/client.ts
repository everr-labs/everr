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
import type { ErrorEvent, ErrorSeverity, Mechanism, Options } from "./types.js";
import { PKG_NAME, PKG_VERSION } from "./version.js";

export interface CaptureInput {
  error: unknown;
  mechanism: Mechanism;
  handled: boolean;
  severity?: ErrorSeverity;
  message?: string;
  attributes?: Attributes;
}

/**
 * The runtime-neutral capture path: normalize, redact, rate limit, mark the
 * active span, emit one log record. It holds no process or DOM state, so any
 * runtime can drive it. `ErrorsInstrumentation` drives it on Node;
 * `@everr/otel-web`'s server entry constructs its own instance.
 */
export class Client {
  readonly options: Options;
  private logger: Logger;
  private readonly rateLimiter: RateLimiter | null;
  private readonly redactPatterns: RegExp[];
  private readonly redactKeys: CollectBehavior;
  private processing = false;

  constructor(options: Options = {}) {
    this.options = options;
    // Falls back to the global API registry, which is a no-op logger until
    // an SDK registers. setLogger swaps in an SDK-injected one.
    this.logger = logs.getLogger(PKG_NAME, PKG_VERSION);
    this.rateLimiter =
      options.rateLimit === false
        ? null
        : new RateLimiter(
            options.rateLimit?.count ?? 5,
            options.rateLimit?.windowMs ?? 5000,
          );
    this.redactPatterns = options.redactPatterns ?? DEFAULT_REDACT_PATTERNS;
    this.redactKeys = options.redactKeys ?? true;
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
      handled: input.handled,
      attributes: input.attributes ?? {},
    };

    if (this.options.beforeSend) {
      event = this.options.beforeSend(event);
      if (!event) {
        return;
      }
    }

    const errorId = generateErrorId();
    const rawAttributes: Attributes = {
      ...event.attributes,
      "exception.type": normalized.type,
      "exception.message": normalized.message,
      ...(normalized.stacktrace
        ? { "exception.stacktrace": normalized.stacktrace }
        : {}),
      "everr.error.handled": event.handled,
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
