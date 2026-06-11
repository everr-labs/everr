import {
  type Attributes,
  type Context,
  ROOT_CONTEXT,
  type Span,
  type SpanContext,
  SpanKind,
  context,
  diag,
  trace,
} from "@opentelemetry/api";
import { type Logger, SeverityNumber, logs } from "@opentelemetry/api-logs";
import { BreadcrumbBuffer } from "./breadcrumb-buffer.js";
import { normalizeError } from "./normalize.js";
import { RateLimiter } from "./rate-limit.js";
import { DEFAULT_SCRUB_PATTERNS, scrubAttributes, scrubString } from "./scrub.js";
import type {
  BreadcrumbInput,
  ErrorEvent,
  Integration,
  Mechanism,
  Options,
} from "./types.js";

export const PKG_NAME = "@everr/auto-otel-errors";
const PKG_VERSION = "0.1.0";

export type Runtime = "node" | "browser";

export interface CaptureInput {
  error: unknown;
  mechanism: Mechanism;
  handled: boolean;
  severity?: "error" | "fatal";
  message?: string;
  attributes?: Attributes;
}

export class Client {
  readonly options: Options;
  readonly runtime: Runtime;
  readonly breadcrumbs: BreadcrumbBuffer | null;
  private readonly integrations: Integration[];
  private readonly logger: Logger;
  private readonly rateLimiter: RateLimiter | null;
  private readonly scrubPatterns: RegExp[];
  private processing = false;

  constructor(options: Options, runtime: Runtime, integrations: Integration[]) {
    this.options = options;
    this.runtime = runtime;
    this.integrations = integrations;
    this.logger = logs.getLogger(PKG_NAME, PKG_VERSION);
    this.rateLimiter =
      options.rateLimit === false
        ? null
        : new RateLimiter(
            options.rateLimit?.count ?? 5,
            options.rateLimit?.windowMs ?? 5000,
          );
    this.scrubPatterns = options.scrubPatterns ?? DEFAULT_SCRUB_PATTERNS;
    this.breadcrumbs =
      options.breadcrumbs === false
        ? null
        : new BreadcrumbBuffer(options.breadcrumbs?.maxEntries ?? 100);
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

  breadcrumbsEnabledFor(category: "console" | "network" | "dom"): boolean {
    const opts = this.options.breadcrumbs;
    return this.breadcrumbs !== null && opts !== false && (opts?.[category] ?? true);
  }

  addBreadcrumb(crumb: BreadcrumbInput): void {
    if (!this.breadcrumbs || this.processing) {
      return;
    }

    this.breadcrumbs.add({
      ...crumb,
      timestamp: Date.now(),
      traceId: trace.getActiveSpan()?.spanContext().traceId,
    });
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
    const attributes = scrubAttributes(
      {
        ...event.attributes,
        "exception.type": normalized.type,
        "exception.message": normalized.message,
        ...(normalized.stacktrace
          ? { "exception.stacktrace": normalized.stacktrace }
          : {}),
        "exception.handled": event.handled,
        "exception.mechanism": event.mechanism,
        "error.id": errorId,
      },
      this.scrubPatterns,
    );
    const body = scrubString(event.message, this.scrubPatterns);
    const activeSpanContext = trace.getActiveSpan()?.spanContext();
    const span = this.startBreadcrumbSpan(errorId, activeSpanContext);
    const emitContext: Context = activeSpanContext
      ? context.active()
      : span
        ? trace.setSpan(ROOT_CONTEXT, span)
        : context.active();

    this.logger.emit({
      severityNumber:
        event.severity === "fatal" ? SeverityNumber.FATAL : SeverityNumber.ERROR,
      severityText: event.severity === "fatal" ? "FATAL" : "ERROR",
      body,
      attributes,
      context: emitContext,
    });

    span?.end(errorTime);
  }

  private startBreadcrumbSpan(
    errorId: string,
    activeSpanContext: SpanContext | undefined,
  ): Span | null {
    if (!this.breadcrumbs) {
      return null;
    }

    const crumbs =
      this.runtime === "browser"
        ? this.breadcrumbs.all()
        : this.breadcrumbs.filtered(activeSpanContext?.traceId);

    if (crumbs.length === 0) {
      return null;
    }

    const tracer = trace.getTracer(PKG_NAME, PKG_VERSION);
    const span = tracer.startSpan(
      "error.context",
      {
        kind: SpanKind.INTERNAL,
        // The buffer preserves insertion order, so the first crumb is earliest.
        startTime: crumbs[0].timestamp,
        attributes: { "error.id": errorId },
        links: activeSpanContext ? [{ context: activeSpanContext }] : [],
      },
      ROOT_CONTEXT,
    );

    for (const crumb of crumbs) {
      span.addEvent(
        scrubString(crumb.message, this.scrubPatterns),
        {
          "breadcrumb.category": crumb.category,
          "breadcrumb.level": crumb.level ?? "info",
          ...(crumb.data ? scrubAttributes(crumb.data, this.scrubPatterns) : {}),
        },
        crumb.timestamp,
      );
    }

    return span;
  }
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
