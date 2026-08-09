import {
  diag,
  type MeterProvider,
  metrics,
  type TracerProvider,
  trace,
} from "@opentelemetry/api";
import { type LoggerProvider, logs } from "@opentelemetry/api-logs";
import type {
  Instrumentation,
  InstrumentationConfig,
} from "@opentelemetry/instrumentation";
import { adoptSharedClient } from "./capture.js";
import { Client } from "./client.js";
import { resolveFlushable } from "./providers.js";
import type { Options } from "./types.js";
import { PKG_NAME, PKG_VERSION } from "./version.js";

const FLUSH_TIMEOUT_MS = 2000;

export interface ErrorsInstrumentationConfig
  extends InstrumentationConfig,
    Options {}

type FatalEventName = "uncaughtException" | "unhandledRejection";

const FATAL_EVENTS: Array<[FatalEventName, string]> = [
  ["uncaughtException", "uncaughtException"],
  ["unhandledRejection", "unhandledrejection"],
];

/**
 * Captures uncaught exceptions and unhandled rejections as OTel exception log
 * records, and backs `captureError` for manual reports. Register it with the
 * SDK like any other instrumentation:
 *
 * ```ts
 * new NodeSDK({ instrumentations: [new ErrorsInstrumentation()] })
 * ```
 *
 * It patches no modules, so it implements `Instrumentation` directly instead
 * of extending `InstrumentationBase` (whose whole contract is module patching).
 */
export class ErrorsInstrumentation
  implements Instrumentation<ErrorsInstrumentationConfig>
{
  readonly instrumentationName = PKG_NAME;
  readonly instrumentationVersion = PKG_VERSION;

  private _config: ErrorsInstrumentationConfig = {};
  // Definitely assigned: the constructor's configure() call always sets it.
  private client!: Client;
  private loggerProvider: LoggerProvider | undefined;
  private tracerProvider: TracerProvider | undefined;
  private meterProvider: MeterProvider | undefined;
  private teardownFns: Array<() => void> = [];

  constructor(config: ErrorsInstrumentationConfig = {}) {
    // Instrumentations enable themselves on construction; registerInstrumentations
    // only calls enable() for one that opted out with `enabled: false`.
    this.configure(config);
  }

  setConfig(config: ErrorsInstrumentationConfig = {}): void {
    const wasEnabled = this.teardownFns.length > 0;
    if (wasEnabled) {
      this.remove();
    }
    this.configure(config);
    this.applyProviders();
  }

  private configure(config: ErrorsInstrumentationConfig): void {
    this._config = { enabled: true, ...config };
    this.client = new Client(this._config);
    // captureError works without any instrumentation, but once one exists its
    // options must apply to manual captures too: redaction that only covered
    // crashes would silently leak the data it was configured to redact.
    adoptSharedClient(this.client, this);
    if (this._config.enabled) {
      this.install();
    }
  }

  getConfig(): ErrorsInstrumentationConfig {
    return this._config;
  }

  enable(): void {
    this._config.enabled = true;
    this.install();
  }

  disable(): void {
    this._config.enabled = false;
    this.remove();
  }

  setTracerProvider(tracerProvider: TracerProvider): void {
    this.tracerProvider = tracerProvider;
  }

  setMeterProvider(meterProvider: MeterProvider): void {
    this.meterProvider = meterProvider;
  }

  setLoggerProvider(loggerProvider: LoggerProvider): void {
    this.loggerProvider = loggerProvider;
    this.applyProviders();
  }

  private applyProviders(): void {
    if (this.loggerProvider) {
      this.client.setLogger(
        this.loggerProvider.getLogger(PKG_NAME, PKG_VERSION),
      );
    }
  }

  private install(): void {
    // Idempotent: registerInstrumentations may enable an instrumentation the
    // constructor already enabled.
    if (this.teardownFns.length > 0) {
      return;
    }

    for (const [eventName, mechanism] of FATAL_EVENTS) {
      const handler = (...args: unknown[]) => {
        const [reason] = args;
        this.client.capture({
          error: reason,
          mechanism,
          handled: false,
          severity: "fatal",
        });

        void this.flush().finally(() => {
          if (this._config.onFatal === "continue") {
            return;
          }

          // Installing a listener suppresses the crash Node would otherwise
          // perform, so we perform it. Unless the app installed its own
          // listener too, in which case the exit decision is the app's.
          const others = process
            .listeners(eventName)
            .filter((listener) => listener !== (handler as unknown));
          if (others.length === 0) {
            process.exit(1);
          }
        });
      };

      process.on(eventName, handler);
      this.teardownFns.push(() => process.off(eventName, handler));
    }
  }

  // Detaches only the crash listeners. captureError stays live through the
  // shared client: disable() is the SDK lifecycle hook, not an off switch for
  // manual reports.
  private remove(): void {
    for (const fn of this.teardownFns) {
      fn();
    }
    this.teardownFns = [];
  }

  /**
   * Flushes logs, spans, and metrics before the process exits. All three
   * matter on a crash: the log record carries the error, and the span that
   * was active carries where it happened. They share one timeout budget, so a
   * stalled exporter cannot hold the process open past it.
   */
  private async flush(): Promise<void> {
    const targets = [
      resolveFlushable(this.loggerProvider) ??
        resolveFlushable(logs.getLoggerProvider()),
      resolveFlushable(this.tracerProvider) ??
        resolveFlushable(trace.getTracerProvider()),
      resolveFlushable(this.meterProvider) ??
        resolveFlushable(metrics.getMeterProvider()),
    ];

    await Promise.race([
      Promise.all(
        targets.map((target) =>
          target
            ?.forceFlush()
            .catch((err) =>
              diag.error(`${PKG_NAME}: flush on fatal failed`, err),
            ),
        ),
      ),
      new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
    ]);
  }
}
