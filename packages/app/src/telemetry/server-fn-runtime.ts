import type { Attributes } from "@opentelemetry/api";
import { isExpectedServerFunctionError } from "./expected-errors";
import { captureError, getTelemetryTracer, SpanKind } from "./node";
import { parameterizeTelemetryPath } from "./paths";

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
    "tanstack.server_fn",
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
            "error.source": "server_fn",
          });
        }
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

function serverFunctionAttributes(
  request: Request | undefined,
  serverFnMeta: ServerFunctionMeta | undefined,
): Attributes {
  return {
    ...(serverFnMeta ? { "rpc.method": serverFnMeta.name } : {}),
    "rpc.service": "server_function",
    "rpc.system": "tanstack-start",
    ...(request ? { "url.path": parameterizeServerFunctionPath(request) } : {}),
  };
}

function parameterizeServerFunctionPath(request: Request) {
  return parameterizeTelemetryPath(new URL(request.url).pathname);
}
