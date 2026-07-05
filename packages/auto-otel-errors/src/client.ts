import {
  type Attributes,
  type Span,
  SpanStatusCode,
  context,
  diag,
  trace,
} from "@opentelemetry/api";
import { type Logger, SeverityNumber, logs } from "@opentelemetry/api-logs";
import { type NormalizedError, normalizeError } from "./normalize.js";
import { RateLimiter } from "./rate-limit.js";
import {
  type CollectBehavior,
  DEFAULT_SCRUB_PATTERNS,
  filterKeyValueData,
  scrubAttributes,
  scrubString,
} from "./scrub.js";
import type { ErrorEvent, ErrorSeverity, Integration, Mechanism, Options } from "./types.js";

export const PKG_NAME = "@everr/auto-otel-errors";
declare const __PACKAGE_VERSION__: string | undefined;
const PKG_VERSION = typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev";

export type Runtime = "node" | "browser";

export interface CaptureInput {
  error: unknown;
  mechanism: Mechanism;
  handled: boolean;
  severity?: ErrorSeverity;
  message?: string;
  attributes?: Attributes;
}

export class Client {
  readonly options: Options;
  readonly runtime: Runtime;
  private readonly integrations: Integration[];
  private readonly logger: Logger;
  private readonly rateLimiter: RateLimiter | null;
  private readonly redactPatterns: RegExp[];
  private readonly redactKeys: CollectBehavior;
  private readonly capturedObjects = new WeakSet<object>();
  private processing = false;

  constructor(options: Options, runtime: Runtime, integrations: Integration[]) {
    this.options = options;
    this.runtime = runtime;
    this.integrations = integrations;
    this.logger = logs.getLogger(PKG_NAME, PKG_VERSION);
    this.rateLimiter =
      options.rateLimit === false
        ? null
        : new RateLimiter(options.rateLimit?.count ?? 5, options.rateLimit?.windowMs ?? 5000);
    this.redactPatterns = options.redactPatterns ?? DEFAULT_SCRUB_PATTERNS;
    this.redactKeys = options.redactKeys ?? true;
  }

  setup(): void {
    for (const integration of this.integrations) {
      try {
        integration.setup(this);
      } catch (err) {
        diag.error(`${PKG_NAME}: failed to set up ${integration.name}`, err);
      }
    }
  }

  teardown(): void {
    for (const integration of this.integrations) {
      try {
        integration.teardown?.();
      } catch (err) {
        diag.error(`${PKG_NAME}: failed to tear down ${integration.name}`, err);
      }
    }
  }

  // Records an error object as already reported so a later handler (e.g. the
  // window "error" event that fires after browserApiErrors re-throws) can skip
  // the duplicate. Only object errors can be tracked.
  markCaptured(error: unknown): void {
    if (isObjectError(error)) {
      this.capturedObjects.add(error);
    }
  }

  wasCaptured(error: unknown): boolean {
    return isObjectError(error) && this.capturedObjects.has(error);
  }

  capture(input: CaptureInput): void {
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
        (normalized.message ? `${normalized.type}: ${normalized.message}` : normalized.type),
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
      ...(normalized.stacktrace ? { "exception.stacktrace": normalized.stacktrace } : {}),
      "everr.error.handled": event.handled,
      "everr.error.mechanism": event.mechanism,
    };
    const filteredAttributes = filterKeyValueData(rawAttributes, this.redactKeys);
    const attributes = {
      ...scrubAttributes(filteredAttributes, this.redactPatterns),
      // The uid is a library-generated identifier, never user data, so it's set
      // after scrubbing: a numeric-heavy UUID would otherwise trip the
      // credit-card pattern and get partially redacted to "[Filtered]".
      "log.record.uid": errorId,
    };
    const body = scrubString(event.message, this.redactPatterns);
    const activeSpan = trace.getActiveSpan();

    // On node, attach the error to the surrounding span so traces show the
    // failure. Browsers rarely run inside a server span, so we skip it there.
    if (this.runtime === "node" && activeSpan) {
      this.markActiveSpan(activeSpan, normalized, input.error);
    }

    this.logger.emit({
      eventName: eventNameForMechanism(event.mechanism),
      severityNumber: severityNumber(event.severity),
      severityText: event.severity.toUpperCase(),
      body,
      attributes,
      exception: input.error,
      context: context.active(),
    });
  }

  private markActiveSpan(span: Span, normalized: NormalizedError, error: unknown): void {
    span.recordException(
      error instanceof Error ? error : { name: normalized.type, message: normalized.message },
    );
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: normalized.message ? `${normalized.type}: ${normalized.message}` : normalized.type,
    });
  }
}

function severityNumber(severity: ErrorSeverity): SeverityNumber {
  switch (severity) {
    case "debug":
      return SeverityNumber.DEBUG;
    case "info":
      return SeverityNumber.INFO;
    case "warn":
      return SeverityNumber.WARN;
    case "fatal":
      return SeverityNumber.FATAL;
    case "error":
      return SeverityNumber.ERROR;
  }
}

function eventNameForMechanism(mechanism: Mechanism): string {
  switch (mechanism) {
    case "express":
    case "fastify":
      return "http.server.request.exception";
    default:
      return "exception";
  }
}

function isObjectError(error: unknown): error is object {
  return typeof error === "object" && error !== null;
}

function generateErrorId(): string {
  const cryptoRef: Crypto | undefined = globalThis.crypto;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }

  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
