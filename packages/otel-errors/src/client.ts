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
 * regular, it applies `beforeSend`, it marks the active span, and it sends one
 * log record. It keeps no process data and no DOM data. Thus each runtime can
 * use it.
 *
 * The path removes no data and it discards no record. The message, the stack,
 * and the attributes from the caller go out without a change, and each call
 * sends one record. An application that must remove a record or change it
 * installs `beforeSend`. A volume limit belongs to the collector or to the
 * ingest, which see all the processes and not only this one.
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
  private processing = false;

  private constructor() {
    // This uses the global API registry. That registry gives a logger that
    // does nothing until an SDK starts. Then setLogger installs the logger
    // from the SDK.
    this.logger = logs.getLogger(PKG_NAME, PKG_VERSION);
  }

  /**
   * Merges the options into the current configuration. A key that is not
   * present keeps its current value.
   */
  configure(options: ClientOptions): void {
    // A value of `undefined` is the same as a key that is not present, and this
    // is also true when the caller sends `undefined` on purpose. Thus a caller
    // can forward an optional configuration, for example
    // `configure({ beforeSend: cfg.beforeSend })`, and it does not remove a
    // hook because its own field has no value. To remove a hook, send
    // `beforeSend: null`.
    if (options.beforeSend !== undefined) {
      this.options.beforeSend = options.beforeSend;
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
    const normalized = normalizeError(input.error);

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

    const attributes: Attributes = {
      ...event.context,
      "exception.type": normalized.type,
      "exception.message": normalized.message,
      ...(normalized.stacktrace
        ? { "exception.stacktrace": normalized.stacktrace }
        : {}),
      "everr.error.mechanism": event.mechanism,
      "log.record.uid": generateErrorId(),
    };
    const activeSpan = trace.getActiveSpan();

    // Attach the error to the span that contains it. Then the traces show the
    // failure. A browser SDK usually has no active span. Then this step does
    // nothing.
    //
    // The span takes the values from the error and not from the result of
    // beforeSend. Thus a hook that changes the record does not change the span.
    // A hook that returns null stops the code before this point, and thus it
    // discards the record and the marking together.
    if (activeSpan) {
      markActiveSpan(activeSpan, normalized);
    }

    this.logger.emit({
      eventName: "exception",
      severityNumber: severityNumber(event.severity),
      severityText: event.severity.toUpperCase(),
      body: event.message,
      attributes,
      exception: input.error,
      context: context.active(),
    });
  }
}

function markActiveSpan(span: Span, error: NormalizedError): void {
  // The code builds the exception structure from the regular error and it does
  // not send the original Error. Thus the span and the log record carry the
  // same three values. An original Error has its own `stack`, and that value
  // has no cause chain.
  span.recordException({
    name: error.type,
    message: error.message,
    stack: error.stacktrace,
  });
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error.message ? `${error.type}: ${error.message}` : error.type,
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
