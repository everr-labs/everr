import { captureError } from "../../errors.js";
import { type ErrorFilter, setErrorFilter } from "../../state/error-filter.js";
import type { Instrumentation } from "../runtime.js";

// The errors instrumentation. It contains the global handlers for an unhandled
// error and an unhandled rejection. Those handlers report through
// `captureError`, and they put their mechanism in the context. A manual
// `captureError` and a React boundary use the same path.
//
// This module also contains the `ignore` filter and the `denyUrls` filter. The
// setup registers them on that shared error path, and thus they apply to each
// error path. The teardown removes them. The filters apply to the errors only,
// and no other signal uses them.

/** A string must occur in the text. A RegExp must agree with the text. */
export type ErrorMatcher = string | RegExp;

export type ErrorsOptions = {
  /** Discards an error when its regular message agrees with this value. */
  ignore?: ErrorMatcher[];
  /**
   * Discards an error when the URL of its script agrees with this value. That
   * URL comes from the top stack frame. If there is no stack frame, it comes
   * from the filename in the handler. If the error has neither of them, this
   * filter does not agree.
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

export function errors(options?: ErrorsOptions): Instrumentation {
  // This function has a name and it is not an arrow function. Thus sampled()
  // can make a hash from instrumentation.name, and the decisions for the
  // different instrumentations are different.
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

// This code prevents two reports from the two handlers. One unhandled
// TypeError, for example "Failed to fetch", can cause the `unhandledrejection`
// event and the `error` event on the window. The two events carry the same
// error object. The code records the objects that each handler received. Thus
// only the first handler reports the error. The rate limiter in the reporter
// still limits the number of reports from one handler. These sets are at module
// level, and thus they continue when the consent procedure constructs the SDK
// again.
const seenByOnerror = new WeakSet<object>();
const seenByRejection = new WeakSet<object>();

function startErrors(): () => void {
  const onError = (event: ErrorEvent) => {
    if (event.error != null) {
      if (seenByRejection.has(event.error)) return;
      seenByOnerror.add(event.error);
      captureError(
        event.error,
        { "everr.error.mechanism": "onerror" },
        event.filename,
      );
    }
  };
  const onRejection = (event: Event) => {
    const reason = (event as { reason?: unknown }).reason;
    if (reason != null && typeof reason === "object") {
      if (seenByOnerror.has(reason)) return;
      seenByRejection.add(reason);
    }
    captureError(reason, { "everr.error.mechanism": "unhandledrejection" });
  };
  addEventListener("error", onError);
  addEventListener("unhandledrejection", onRejection);

  return () => {
    removeEventListener("error", onError);
    removeEventListener("unhandledrejection", onRejection);
  };
}
