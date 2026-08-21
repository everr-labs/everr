import { captureError } from "@everr/otel-errors";
import type { Attributes, Tracer } from "@opentelemetry/api";
import { SpanKind } from "@opentelemetry/api";
import { recordServerFunctionName } from "./server-fn-name.js";

export interface ServerFnTelemetryOptions {
  /**
   * Errors the app treats as control flow rather than faults, so they are not
   * captured. TanStack Start signals `redirect()` and `notFound()` as thrown
   * values, and apps add their own expected messages on top.
   */
  isExpectedError?: (error: unknown) => boolean;
  /** Tracer name for the server-function span. */
  tracerName?: string;
}

export type ServerFunctionMeta = {
  id: string;
  name: string;
  filename: string;
};

export async function instrumentServerFunction<T>(
  run: () => T | Promise<T>,
  {
    tracer,
    request,
    serverFnMeta,
    isExpectedError,
  }: {
    tracer: Tracer;
    request: Request | undefined;
    serverFnMeta: ServerFunctionMeta | undefined;
    isExpectedError?: (error: unknown) => boolean;
  },
) {
  // Report the name to the transport wrapper, which only sees the opaque
  // /_serverFn/<id> path: it renames its SERVER span and the x-everr-route
  // echo to `/_serverFn/{name}` once the response settles.
  if (serverFnMeta) recordServerFunctionName(serverFnMeta.name);

  const attributes = serverFunctionAttributes(request, serverFnMeta);

  return tracer.startActiveSpan(
    serverFnMeta ? `serverFn ${serverFnMeta.name}` : "serverFn",
    {
      attributes,
      kind: SpanKind.INTERNAL,
    },
    async (span) => {
      try {
        return await run();
      } catch (error) {
        if (!isExpectedError?.(error)) {
          captureError(error, {
            ...attributes,
            "everr.error.source": "server_fn",
          });
        }
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * A server function invocation is not an RPC, so it does not borrow the
 * `rpc.*` conventions: it describes itself under `everr.server_function.*`.
 * The span stays INTERNAL — over HTTP it nests inside the framework's
 * `POST /_serverFn/:id` SERVER span, which already counts the inbound
 * request, and in-process it is a plain function call with no request of
 * its own. `transport` records that split explicitly.
 */
function serverFunctionAttributes(
  request: Request | undefined,
  serverFnMeta: ServerFunctionMeta | undefined,
): Attributes {
  return {
    ...(serverFnMeta
      ? { "everr.server_function.name": serverFnMeta.name }
      : {}),
    "everr.server_function.transport": request ? "http" : "in-process",
  };
}
