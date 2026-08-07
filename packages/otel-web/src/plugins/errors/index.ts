import { type ErrorFilter, report, setErrorFilter } from "../../errors.js";
import type { Plugin } from "../runtime.js";

// The errors plugin: the global unhandled-error and unhandled-rejection
// handlers (reported as unhandled through the shared `report` binding, the
// same path manual `captureError` and React boundaries ride), plus the
// declarative `ignore` / `denyUrls` filters, registered on that shared error
// path at setup so they gate every error path, and unregistered at teardown.
// Filters gate errors only; no other signal consults them.

/** String means substring match, RegExp means test. */
export type ErrorMatcher = string | RegExp;

export type ErrorsOptions = {
  /** Drops errors whose normalized message matches. */
  ignore?: ErrorMatcher[];
  /**
   * Drops errors whose reporting script URL matches (the top stack frame,
   * falling back to the handler's filename; no match when neither exists).
   */
  denyUrls?: ErrorMatcher[];
};

const matches = (
  matchers: ErrorMatcher[] | undefined,
  value: string | undefined,
): boolean =>
  value !== undefined &&
  !!matchers?.some((m) =>
    typeof m === "string" ? value.includes(m) : m.test(value),
  );

export function errors(options?: ErrorsOptions): Plugin {
  // Named (not an arrow) so sampled() can hash a real identity from
  // plugin.name instead of decorrelating nothing.
  return function errors() {
    const stopHandlers = startErrors();
    const filter: ErrorFilter = (message, scriptUrl) =>
      matches(options?.ignore, message) ||
      matches(options?.denyUrls, scriptUrl);
    const removeFilter =
      options?.ignore || options?.denyUrls ? setErrorFilter(filter) : undefined;
    return () => {
      removeFilter?.();
      stopHandlers();
    };
  };
}

// Cross-handler deduplication: a single unhandled TypeError (e.g.
// "Failed to fetch") can fire both `unhandledrejection` and `error` on the
// window, each carrying the same error object. Track which objects each
// handler has seen so only the first handler to fire reports the error;
// the rate limiter in the reporter still throttles volume within a single
// handler. Module-level: the sets survive a consent re-init.
const seenByOnerror = new WeakSet<object>();
const seenByRejection = new WeakSet<object>();

function startErrors(): () => void {
  const onError = (event: ErrorEvent) => {
    if (event.error != null) {
      if (seenByRejection.has(event.error)) return;
      seenByOnerror.add(event.error);
      report(event.error, "onerror", false, undefined, event.filename);
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
    removeEventListener("error", onError);
    removeEventListener("unhandledrejection", onRejection);
  };
}
