// The current error filter. The errors() instrumentation registers it, and
// captureError reads it on each report. It continues after shutdown() until
// the instrumentation's own teardown removes it.

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

export const currentErrorFilter = (): ErrorFilter | undefined => filter;

export function setErrorFilter(next: ErrorFilter): () => void {
  filter = next;
  return () => {
    if (filter === next) filter = undefined;
  };
}
