import { AlertingError, alertingErrorInfo } from "@/data/alerting/errors";

/**
 * Run an alerting operation and answer with what it returned, or with the
 * refusal it raised.
 *
 * A refusal is an `AlertingError`, which carries the status it means: 422 for
 * input a schema rejected, 404 for an unknown channel, 409 for one still
 * sending. Anything else is a bug and stays an unhandled 500, so it reaches
 * the error reporter rather than being flattened into a message the caller
 * cannot act on. That includes a `ZodError` from reading stored data, which
 * says the server is broken, not the request.
 */
export async function alertingJson(
  operation: () => Promise<unknown>,
): Promise<Response> {
  try {
    return Response.json(await operation());
  } catch (cause) {
    const info = alertingErrorInfo(cause);
    if (info) {
      return Response.json(
        { error: info.message, code: info.code },
        { status: info.status },
      );
    }
    throw cause;
  }
}

/**
 * The JSON object a request carries. Raises rather than returning null, so a
 * handler reads it inside `alertingJson` and never repeats a guard.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AlertingError(400, "validation", "request body is not JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AlertingError(
      400,
      "validation",
      "request body must be a JSON object",
    );
  }
  return body;
}
