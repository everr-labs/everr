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

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2000;

/**
 * For crash handling only. The shared client holds `beforeSend`, and
 * `configure` sets it. Thus an app configures the capture in one place. This
 * is true if the app registers this instrumentation, and also if it does
 * not.
 */
export interface ErrorsInstrumentationConfig extends InstrumentationConfig {
  /**
   * The action after the flush of a fatal error. The default value is "exit".
   * With "exit", the process stops as Node stops it when no listener is
   * installed. With "continue", the process continues to operate.
   */
  onFatal?: "exit" | "continue";
  /**
   * The time limit in milliseconds for the flush of the providers before the
   * process stops. The default value is 2000. The three signals share this one
   * budget. Thus an exporter that stops cannot keep the process open after the
   * limit. Use a small value in a function that pays for the time, and a large
   * value with an exporter that has a large queue.
   */
  shutdownTimeout?: number;
  /**
   * Controls the exit when the app registered its own listener for the same
   * event. The default value is false.
   *
   * - `false`: the instrumentation stops the process only when its handler is
   *   the one handler. If the app installed a listener also, the app owns the
   *   exit. This is the same behavior that Node has: a listener stops the crash
   *   that Node does, and thus the app that installed the listener decides.
   * - `true`: the instrumentation always stops the process, and the listener of
   *   the app cannot prevent it.
   *
   * `onFatal: "continue"` stops the exit in the two conditions.
   */
  exitEvenIfOtherHandlersAreRegistered?: boolean;
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

        // Write the error to stderr first, before the capture and before the
        // flush. A listener prevents the report that Node writes. Thus without
        // this line a container that stops writes nothing to its own log, and
        // the error is visible only if the flush to the collector was a
        // success. This line comes first because it must not have a dependency
        // on the capture, on the flush, or on the exit decision below.
        console.error(reason);

        capture({
          error: reason,
          mechanism,
          severity: "fatal",
        });

        // Read the count now and not after the flush. The list can change
        // while the flush operates, and the decision belongs to the condition
        // at the time of the crash. This handler is in the list at this time.
        // Thus a count of more than one shows a listener of the app.
        const otherHandlers = process.listenerCount(eventName) > 1;

        void this.flush().finally(() => {
          if (this._config.onFatal === "continue") {
            return;
          }

          // A listener prevents the crash that Node does. Thus this code does
          // the crash. But if the app installed a listener also, the app
          // controls the exit. Refer to
          // exitEvenIfOtherHandlersAreRegistered.
          if (
            this._config.exitEvenIfOtherHandlersAreRegistered ||
            !otherHandlers
          ) {
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
   * have one time limit together, which is `shutdownTimeout`. Thus an exporter
   * that stops cannot keep the process open after that limit.
   *
   * Promise.race gives the first result, but it does not stop the loser. Thus
   * the code stops the timer when the flush is a success, and it also removes
   * the reference. Each step alone keeps the event loop free after a crash
   * that the process survives; together they also keep no timer in the heap.
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

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
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
        new Promise<void>((resolve) => {
          timer = setTimeout(
            resolve,
            this._config.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
