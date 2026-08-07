import { currentEmit } from "./current.js";

// Native error reporting: the explicit `captureError` plus the shared
// `report` binding every error path rides (`captureReactError` lives in the
// react entry, the global unhandled handlers in the errors() plugin, both
// sharing the live binding, so index consumers never pay for either),
// emitted through the SDK pipeline so every error carries the analytics
// envelope and joins the session's other signals. This deliberately owns the
// small slice of error handling the browser needs instead of depending on
// @everr/otel-errors, which is Node-only: the SDK stays a fraction of the
// bytes and carries no OTel API. The attribute names below are a wire
// contract shared with it (`exception.*`, `everr.error.*`, `everr.react.*`),
// so browser and server errors group identically through the
// errorFingerprint UDF.
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

export type Report = (
  error: unknown,
  mechanism: "onerror" | "unhandledrejection" | "react" | "manual",
  handled: boolean,
  extra?: ExtraAttrs,
  /** The reporting script URL when the handler knows it (ErrorEvent.filename). */
  fileName?: string,
) => void;

/**
 * The registered error filter: returns true to drop the error. Consulted on
 * every browser error path (global handlers, React boundaries, manual
 * `captureError`); a filtered report is a silent success. One slot, not a
 * registry: only the errors() plugin sets it (at most once per init), so no
 * filtering exists without it.
 */
export type ErrorFilter = (
  message: string,
  scriptUrl: string | undefined,
) => boolean;

let filter: ErrorFilter | undefined;

export function setErrorFilter(next: ErrorFilter): () => void {
  filter = next;
  return () => {
    if (filter === next) filter = undefined;
  };
}

// The top stack frame's script URL: the first frame-shaped line's
// `url:line:col`, both Chrome ("at fn (url:1:2)", "at url:1:2") and Firefox
// ("fn@url:1:2") shapes. Chrome's leading "Error: <message>" line is not
// frame-shaped, so a url:line:col token inside the message never matches.
function frameUrl(stack: string | undefined): string | undefined {
  for (const line of stack?.split("\n") ?? []) {
    const m = /(?:^\s*at (?:.*[(\s])?|.*@)(\S+?):\d+:\d+\)?$/.exec(line);
    if (m) return m[1];
  }
  return undefined;
}

// At most 5 reports per identical error (type, message, top frame) per
// 5s window, so a render or event loop cannot flood the batch queue.
// Module-level: the window survives a consent re-init, which is the point.
const hits = new Map<string, number[]>();

// The browser reporter: normalization, filter, rate limit, emit. It samples
// the current pipeline per call (warn before init, silent after shutdown
// come from the shared binding), so no wiring step exists on the browser at
// all.
const browserReport: Report = (error, mechanism, handled, extra, fileName) => {
  const emit = currentEmit();
  if (!emit) return;
  // Telemetry must never break the page: reporting is best-effort.
  try {
    const isError = error instanceof Error;
    const type = errorTypeOf(error);
    const message = isError ? error.message : safeString(error);
    const stack = isError
      ? (error.stack ?? `${error.name}: ${error.message}`)
      : undefined;

    if (filter?.(message, frameUrl(stack) ?? fileName)) return;

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

// A live binding: the react entry and the errors() plugin import it. The
// browser reporter is the default and needs no wiring; the server entry
// swaps in its adapter over @everr/otel-errors/core here, and unbinding
// restores the default.
export let report: Report = browserReport;

export function bindReport(next: Report): () => void {
  report = next;
  return () => {
    report = browserReport;
  };
}

/** Reports a handled error, with optional extra attributes. */
export function captureError(
  error: unknown,
  attributes?: ExtraAttrs,
  options?: { handled?: boolean },
): void {
  report(error, "manual", options?.handled ?? true, attributes);
}

/**
 * The one spelling of an error's type across signals (exception.type here,
 * error.type on network spans): the class name, with the same fallbacks.
 */
export function errorTypeOf(error: unknown): string {
  return error instanceof Error ? error.name || "Error" : "NonError";
}
