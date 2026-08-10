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
  /** The attributes from the caller. They go below the `exception.*` set. */
  context?: Attributes;
}

/**
 * The capture path for all runtimes. It does these steps: it makes the error
 * regular, it redacts the data, it applies the rate limit, it marks the active
 * span, and it sends one log record. It keeps no process data and no DOM data.
 * Thus each runtime can use it.
 *
 * A process has only one client, and this class makes sure of that. The
 * constructor is private. The `shared()` function is the only way to get an
 * instance. The two package entries do not export the class. The `capture.ts`
 * module supplies the functions that callers use.
 */
export class Client {
  private static instance: Client | null = null;

  /** The client for this process. The first call builds it with the defaults. */
  static shared(): Client {
    if (!Client.instance) {
      Client.instance = new Client();
    }
    return Client.instance;
  }

  /** For tests only. Call it with `resetSharedClient` in `capture.ts`. */
  static reset(): void {
    Client.instance = null;
  }

  // All the defaults are here. Thus the constructor only finds the logger.
  // The configure() function is the only function that changes a default.
  private options: ClientOptions = {};
  private logger: Logger;
  private rateLimiter: RateLimiter | null = new RateLimiter(5, 5000);
  private redactPatterns: RegExp[] = DEFAULT_REDACT_PATTERNS;
  private redactKeys: CollectBehavior = true;
  private processing = false;

  private constructor() {
    // This uses the global API registry. That registry gives a logger that
    // does nothing until an SDK starts. Then setLogger installs the logger
    // from the SDK.
    this.logger = logs.getLogger(PKG_NAME, PKG_VERSION);
  }

  /**
   * Merges the options into the current configuration. A key that is not
   * present keeps its current value. Thus a caller that sets one field again
   * does not change the other fields to their defaults.
   *
   * A new rate limiter starts only when `rateLimit` is present, because a new
   * rate limiter loses the recorded windows for each fingerprint.
   */
  configure(options: ClientOptions): void {
    // A value of `undefined` is always the same as a key that is not present.
    // This is also true when the caller sends `undefined` on purpose. A caller
    // can forward an optional configuration, for example
    // `configure({ beforeSend: cfg.beforeSend })`. Such a caller must not
    // remove a hook or start the rate-limit windows again because its own
    // field has no value. To remove a hook, send `beforeSend: null`. A spread
    // operator cannot do this. Thus the merge copies only the keys that have a
    // value.
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) {
        (this.options as Record<string, unknown>)[key] = value;
      }
    }
    // A new rate limiter starts only when `rateLimit` is present, because a
    // new rate limiter loses the recorded windows for each fingerprint.
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

  /** Sends the records to the logger of one provider, not to the global one. */
  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  capture(input: CaptureInput): void {
    // This flag prevents a loop. If process() throws an error, the global
    // handlers must not call capture() again.
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
      // The library makes the uid, and it is not user data. Thus it is set
      // after the redaction. A UUID with many digits can agree with the
      // pattern for a credit card. Then the redaction changes part of the uid
      // to "[Filtered]".
      "log.record.uid": errorId,
    };
    const body = redactString(event.message, this.redactPatterns);
    const activeSpan = trace.getActiveSpan();

    // Attach the error to the span that contains it. Then the traces show the
    // failure. A browser SDK usually has no active span. Then this step does
    // nothing.
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
