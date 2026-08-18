import type { Attributes } from "@opentelemetry/api";
import { isExpectedServerFunctionError } from "./expected-errors";
import { captureError, getTelemetryTracer, SpanKind } from "./node";

const tracer = getTelemetryTracer("everr-app.server_fn");

type ServerFunctionMeta = {
  id: string;
  name: string;
  filename: string;
};

export async function instrumentServerFunction<T>(
  request: Request | undefined,
  serverFnMeta: ServerFunctionMeta | undefined,
  run: () => T | Promise<T>,
) {
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
        if (!isExpectedServerFunctionError(error)) {
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
