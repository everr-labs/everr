// The nine HTTP methods in the OpenTelemetry HTTP semantic conventions.
//
// The conventions also set the name of an HTTP server span to
// `{http.request.method} {http.route}`, for example `GET /api/orders`. The
// method is therefore in the root span name, and no query change is necessary.
//
// The list is complete on purpose. A match on any first word would put a badge
// on `SELECT users`, which is a database span and not a request.
const HTTP_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "CONNECT",
  "OPTIONS",
  "TRACE",
  "PATCH",
]);

// The methods that only read. Every other method in the set above changes
// state. The method badge gives one tone to each of the two groups.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

/** True when the method only reads. False when the method changes state. */
export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method);
}

export type SpanNameParts = {
  /** The uppercase HTTP method. Null when the name starts with another word. */
  method: string | null;
  /** The name without the method, so that the row shows the method one time. */
  label: string;
};

/**
 * Divides a root span name into an HTTP method and the rest of the name.
 *
 * The match is exact and case sensitive. The conventions use uppercase, and a
 * lowercase `get` is usually a function name and not a request.
 *
 * A method with no route, for example `GET`, gives an empty label. The row then
 * shows only the badge.
 */
export function splitSpanName(spanName: string): SpanNameParts {
  const spaceIndex = spanName.indexOf(" ");
  const head = spaceIndex === -1 ? spanName : spanName.slice(0, spaceIndex);

  if (!HTTP_METHODS.has(head)) {
    return { method: null, label: spanName };
  }

  return {
    method: head,
    label: spaceIndex === -1 ? "" : spanName.slice(spaceIndex + 1).trim(),
  };
}
