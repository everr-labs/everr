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
import { capture, setLogger } from "./capture.js";
import { resolveFlushable } from "./providers.js";
import { PKG_NAME, PKG_VERSION } from "./version.js";

const FLUSH_TIMEOUT_MS = 2000;

/**
 * For crash handling only. The shared client holds the redaction, the rate
 * limit, and `beforeSend`, and `configure` sets them. Thus an app configures
 * the capture in one place. This is true if the app registers this
 * instrumentation, and also if it does not.
 */
export interface ErrorsInstrumentationConfig extends InstrumentationConfig {
  /**
   * The action after the flush of a fatal error. The default value is "exit".
   * With "exit", the process stops as Node stops it when no listener is
   * installed. With "continue", the process continues to operate.
   */
  onFatal?: "exit" | "continue";
}

// Two instrumentations install two sets of crash handlers. Then the code
// captures each crash two times, and the two exits occur at the same time.
// This variable is at module level because the conflict is between the
// instances. The code only gives a warning, because the second instrumentation
// continues to operate correctly.
let installed: object | null = null;

type FatalEventName = "uncaughtException" | "unhandledRejection";

const FATAL_EVENTS: Array<[FatalEventName, string]> = [
  ["uncaughtException", "uncaughtException"],
  ["unhandledRejection", "unhandledrejection"],
];

/**
 * Captures the uncaught exceptions and the unhandled rejections as OTel
 * exception log records. It also supplies `captureError` for manual reports.
 * Register it with the SDK as you register the other instrumentations:
 *
 * ```ts
 * new NodeSDK({ instrumentations: [new ErrorsInstrumentation()] })
 * ```
 *
 * This class does not patch modules. Thus it implements `Instrumentation`
 * directly. It does not extend `InstrumentationBase`, because the full
 * function of that class is the patching of modules.
 */
export class ErrorsInstrumentation
  implements Instrumentation<ErrorsInstrumentationConfig>
{
  readonly instrumentationName = PKG_NAME;
  readonly instrumentationVersion = PKG_VERSION;

  private _config: ErrorsInstrumentationConfig = {};
  private loggerProvider: LoggerProvider | undefined;
  private tracerProvider: TracerProvider | undefined;
  private meterProvider: MeterProvider | undefined;
  private teardownFns: Array<() => void> = [];

  constructor(config: ErrorsInstrumentationConfig = {}) {
    // Each instrumentation enables itself when the code constructs it. The
    // registerInstrumentations function calls enable() only for an
    // instrumentation that has `enabled: false`.
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
      setLogger(this.loggerProvider.getLogger(PKG_NAME, PKG_VERSION));
    }
  }

  private install(): void {
    // You can call this function more than one time. The
    // registerInstrumentations function can enable an instrumentation that the
    // constructor enabled before.
    if (this.teardownFns.length > 0) {
      return;
    }

    if (installed && installed !== this) {
      diag.warn(
        `${PKG_NAME}: a second ErrorsInstrumentation was installed; every crash is now captured twice`,
      );
    }
    installed = this;

    for (const [eventName, mechanism] of FATAL_EVENTS) {
      const handler = (...args: unknown[]) => {
        const [reason] = args;
        capture({
          error: reason,
          mechanism,
          severity: "fatal",
        });

        void this.flush().finally(() => {
          if (this._config.onFatal === "continue") {
            return;
          }

          // A listener prevents the crash that Node does. Thus this code does
          // the crash. But if the app installed a listener also, the app
          // controls the exit.
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

  // Removes only the crash listeners. The captureError function continues to
  // operate through the shared client. The disable() function is the hook for
  // the SDK lifecycle. It is not a switch that stops the manual reports.
  private remove(): void {
    for (const fn of this.teardownFns) {
      fn();
    }
    this.teardownFns = [];
    if (installed === this) {
      installed = null;
    }
  }

  /**
   * Flushes the logs, the spans, and the metrics before the process stops. A
   * crash needs all three. The log record contains the error. The span that
   * was active shows the location of the error. The three flush operations
   * have one time limit together. Thus an exporter that stops cannot keep the
   * process open after that limit.
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
