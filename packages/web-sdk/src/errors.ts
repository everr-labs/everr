import type { Emit } from "./emitter.js";

// Native error capture: window "error" and "unhandledrejection" listeners
// plus the explicit `captureError` (`captureReactError` lives in the react
// entry, sharing the live `report` binding, so index consumers never pay
// for it), emitted through the SDK pipeline so every error carries the
// analytics envelope and joins the
// session's other signals. This deliberately owns the small slice of error
// handling the browser needs instead of depending on @everr/auto-otel-errors:
// the SDK stays a fraction of the bytes and never contends for that package's
// global client. The attribute names below are a wire contract shared with it
// (`exception.*`, `everr.error.*`, `everr.react.*`), so browser and server errors group
// identically through the errorFingerprint UDF. Errors have no `disable` key
// and no options.
//
// Deliberately absent (decided 2026-07-27, function per byte): message/stack
// scrubbing (content ships verbatim; scrubbing must return before errors are
// exposed to external consented-mode adopters, see ticket 09) and cause-chain
// rendering (nothing the SDK observes attaches `cause` today).

const safeString = (value: unknown): string => {
  try {
    return typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? String(value));
  } catch {
    return "[unserializable]";
  }
};

type ExtraAttrs = Record<string, string | number | boolean>;

type Report = (
  error: unknown,
  mechanism: "onerror" | "unhandledrejection" | "react" | "manual",
  handled: boolean,
  extra?: ExtraAttrs,
) => void;

// A live binding: the react entry imports it, and startErrors/stop swap the
// implementation underneath both entries at once.
export let report: Report = () => console.warn("[everr] SDK not initialized");

/** Reports a handled error, with optional extra attributes. */
export function captureError(
  error: unknown,
  attributes?: ExtraAttrs,
  options?: { handled?: boolean },
): void {
  report(error, "manual", options?.handled ?? true, attributes);
}

// Wires the live `report` binding (rate limit + emit) without any global
// listeners: the server half of error capture. SSR errors reach it through
// captureError only; process-level handlers are deliberately absent (an
// uncaughtException listener changes Node's exit semantics, and request
// errors are caught by the framework before they ever get there, so hosts
// wire framework hooks like Next's onRequestError to captureError instead).
/**
 * The one spelling of an error's type across signals (exception.type here,
 * error.type on network spans): the class name, with the same fallbacks.
 */
export function errorTypeOf(error: unknown): string {
  return error instanceof Error ? error.name || "Error" : "NonError";
}

export function startReporting(emit: Emit): () => void {
  const hits = new Map<string, number[]>();

  report = (error, mechanism, handled, extra) => {
    // Telemetry must never break the page: reporting is best-effort.
    try {
      const isError = error instanceof Error;
      const type = errorTypeOf(error);
      const message = isError ? error.message : safeString(error);
      const stack = isError
        ? (error.stack ?? `${error.name}: ${error.message}`)
        : undefined;

      // At most 5 reports per identical error (type, message, top frame) per
      // 5s window, so a render or event loop cannot flood the batch queue.
      const key = `${type}|${message}|${stack?.split("\n", 2)[1] ?? ""}`;
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((t) => t > now - 5_000);
      if (recent.length >= 5) return;
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 1_000)
        hits.forEach((stamps, staleKey) => {
          if (!stamps.some((t) => t > now - 5_000)) hits.delete(staleKey);
        });

      // 17 is the OTel ERROR severity.
      emit(
        "exception",
        {
          ...extra,
          "exception.type": type,
          "exception.message": message,
          "exception.stacktrace": stack,
          "everr.error.handled": handled,
          "everr.error.mechanism": mechanism,
        },
        17,
        message ? `${type}: ${message}` : type,
      );
    } catch {
      // Swallowed by design.
    }
  };

  return () => {
    report = () => {};
  };
}

export function startErrors(emit: Emit): () => void {
  const stopReporting = startReporting(emit);

  // Cross-handler deduplication: a single unhandled TypeError (e.g.
  // "Failed to fetch") can fire both `unhandledrejection` and `error` on the
  // window, each carrying the same error object. Track which objects each
  // handler has seen so only the first handler to fire reports the error;
  // the rate limiter in startReporting still throttles volume within a single
  // handler.
  const seenByOnerror = new WeakSet<object>();
  const seenByRejection = new WeakSet<object>();
  const onError = (event: ErrorEvent) => {
    if (event.error != null) {
      if (seenByRejection.has(event.error)) return;
      seenByOnerror.add(event.error);
      report(event.error, "onerror", false);
    }
  };
  const onRejection = (event: Event) => {
    const reason = (event as { reason?: unknown }).reason;
    if (reason != null && typeof reason === "object") {
      if (seenByOnerror.has(reason)) return;
      seenByRejection.add(reason);
    }
    report(reason, "unhandledrejection", false);
  };
  addEventListener("error", onError);
  addEventListener("unhandledrejection", onRejection);

  return () => {
    stopReporting();
    removeEventListener("error", onError);
    removeEventListener("unhandledrejection", onRejection);
  };
}
