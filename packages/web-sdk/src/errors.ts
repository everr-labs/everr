import type { Emit } from "./emitter.js";

// Native error capture: window "error" and "unhandledrejection" listeners
// plus the explicit `captureReactError` / `captureError`, emitted through the
// SDK pipeline so every error carries the analytics envelope and joins the
// session's other signals. This deliberately owns the small slice of error
// handling the browser needs instead of depending on @everr/auto-otel-errors:
// the SDK stays a fraction of the bytes and never contends for that package's
// global client. The attribute names below are a wire contract shared with it
// (`exception.*`, `everr.error.*`), so browser and server errors group
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

let report: Report = () => console.warn("[everr] SDK not initialized");

export function captureReactError(
  error: unknown,
  errorInfo?: { componentStack?: string | null },
): void {
  // Before init this warns (never throws) so miswiring is visible; after
  // shutdown it is silent by design. Router error components call this from
  // effects, so SSR renders never reach it.
  report(
    error,
    "react",
    true,
    errorInfo?.componentStack
      ? { "react.component_stack": errorInfo.componentStack }
      : undefined,
  );
}

/** Reports a handled error, with optional extra attributes. */
export function captureError(
  error: unknown,
  attributes?: ExtraAttrs,
  options?: { handled?: boolean },
): void {
  report(error, "manual", options?.handled ?? true, attributes);
}

export function startErrors(emit: Emit): () => void {
  const hits = new Map<string, number[]>();

  report = (error, mechanism, handled, extra) => {
    // Telemetry must never break the page: reporting is best-effort.
    try {
      const isError = error instanceof Error;
      const type = isError ? error.name || "Error" : "NonError";
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

      // Errors rank first (exit priority 0) in exit-flush truncation; 17 is
      // the OTel ERROR severity.
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
        0,
        17,
        message ? `${type}: ${message}` : type,
      );
    } catch {
      // Swallowed by design.
    }
  };

  const onError = (event: ErrorEvent) => {
    // Resource-load and cross-origin "Script error." events carry no error
    // object; skip them.
    if (event.error != null) report(event.error, "onerror", false);
  };
  const onRejection = (event: Event) => {
    report((event as { reason?: unknown }).reason, "unhandledrejection", false);
  };
  addEventListener("error", onError);
  addEventListener("unhandledrejection", onRejection);

  return () => {
    report = () => {};
    removeEventListener("error", onError);
    removeEventListener("unhandledrejection", onRejection);
  };
}
