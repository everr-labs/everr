import { currentEmit } from "./emit.js";

// The error reports of the browser. This module has the `captureError`
// function, and each browser error path uses it. The ErrorBoundary is in the
// react entry, and it imports `captureError` through the "#report" subpath.
// The package.json selects
// this module for the browser and the report.server module for Node. The
// global handlers for the unhandled errors are in the errors()
// instrumentation, and they import this module directly, because that
// instrumentation exists only in the browser. Thus a consumer of the index
// entry gets neither the react code nor the server code in its build.
//
// The SDK pipeline sends these records. Thus each error carries the analytics
// envelope, and it goes with the other signals of the session.
//
// This module contains the small part of the error handling that a browser
// needs. It does not use @everr/otel-errors, which is for Node only. Thus the
// SDK is much smaller, and it contains no OTel API. The attribute names below
// are the same as the names in that package: `exception.*`, `everr.error.*`,
// and `everr.react.*`. Thus the errorFingerprint UDF groups the browser errors
// and the server errors in the same way.
//
// The SDK sends the message and the stack without a change, and this is
// correct. The application owns the policy on the data, the same as in the
// other browser SDKs. The beforeSend option of the WebSDK is the place for
// that policy: an exception record goes through the emitter, and thus the hook
// operates on it with all the other records.
//
// The display of the chain of causes is absent, because no error that the SDK
// sees has a `cause` today.

const safeString = (value: unknown): string => {
  try {
    return typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? String(value));
  } catch {
    return "[unserializable]";
  }
};

/**
 * The attributes from the caller that are attached to one error report. A
 * path that is not manual, for example a global handler or a React boundary,
 * puts "everr.error.mechanism" here. A record without that attribute is a
 * manual report.
 */
export type ErrorContext = Record<
  string,
  string | number | boolean | undefined
>;

/**
 * The error filter that the app registers. It returns true to discard the
 * error. The code calls it on each browser error path: the global handlers, the
 * React boundaries, and a manual `captureError`. When the filter discards a
 * report, the code continues and gives no warning.
 *
 * There is one filter and not a list. Only the errors() instrumentation sets
 * it, and it sets it a maximum of one time for each WebSDK. Thus without that
 * instrumentation there is no filter.
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

// The script URL of the top stack frame. It is the `url:line:col` part of the
// first line that has the structure of a frame. The code accepts the Chrome
// structures, "at fn (url:1:2)" and "at url:1:2", and the Firefox structure,
// "fn@url:1:2". The first line in Chrome is "Error: <message>", and it does not
// have the structure of a frame. Thus a `url:line:col` text in the message
// never agrees with the pattern.
function frameUrl(stack: string | undefined): string | undefined {
  for (const line of stack?.split("\n") ?? []) {
    const m = /(?:^\s*at (?:.*[(\s])?|.*@)(\S+?):\d+:\d+\)?$/.exec(line);
    if (m) return m[1];
  }
  return undefined;
}

// A maximum of 5 reports for the same error in a window of 5 s. Two errors are
// the same when their type, message, and top frame are the same. Thus a loop in
// a render or in the event handling cannot fill the batch queue. This variable
// is at module level, and thus the window continues when the consent procedure
// constructs a new SDK. That is the intention.
const hits = new Map<string, number[]>();

/**
 * Reports an error. The context attributes are optional. It does these steps:
 * it makes the error regular, it applies the filter, it applies the rate
 * limit, and it sends the record. It reads the current pipeline at each call.
 * It gives a warning before a WebSDK exists, and it does nothing after
 * shutdown. Thus the browser needs no setup step.
 *
 * @param fileName The URL of the script that reports, if the handler knows
 * it. It comes from ErrorEvent.filename, and only the denyUrls filter reads
 * it.
 */
export const captureError = (
  error: unknown,
  context?: ErrorContext,
  fileName?: string,
): void => {
  const emit = currentEmit();
  if (!emit) return;
  // The telemetry must never cause a failure of the page. Thus the code tries
  // to report the error, but it accepts a failure.
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

    // The value 17 is the OTel severity ERROR.
    emit(
      "exception",
      {
        ...context,
        "exception.type": type,
        "exception.message": message,
        "exception.stacktrace": stack,
      },
      17,
      message ? `${type}: ${message}` : type,
    );
  } catch {
    // The code ignores this error, and this is correct.
  }
};

/**
 * The one method to write the type of an error in all the signals. This module
 * writes it as exception.type, and a network span writes it as error.type. The
 * value is the name of the class, and the alternative values are the same.
 */
export function errorTypeOf(error: unknown): string {
  return error instanceof Error ? error.name || "Error" : "NonError";
}
