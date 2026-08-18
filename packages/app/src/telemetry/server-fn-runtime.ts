import type { Attributes } from "@opentelemetry/api";
import { isExpectedServerFunctionError } from "./expected-errors";
import { captureError, getTelemetryTracer, SpanKind } from "./node";
import { serverRouteTemplate } from "./server-router";

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
      kind: SpanKind.SERVER,
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
 * The RPC semantic conventions, in their current spelling. `rpc.system`,
 * `rpc.service` and `rpc.grpc.status_code` are all deprecated: the system
 * became `rpc.system.name`, and `rpc.service` was absorbed into `rpc.method`,
 * which now carries the fully-qualified `{service}/{method}` name.
 * https://opentelemetry.io/docs/specs/semconv/non-normative/rpc-migration/
 *
 * SERVER, as the conventions require of an inbound RPC span, even though each
 * one nests inside the framework's `POST /_serverFn/:id` SERVER span: every
 * consumer that splits traffic by span kind also filters on an attribute only
 * one of the two carries (`http.request.method` there, `rpc.system.name`
 * here), so the pair never lands on the same panel.
 */
const RPC_SERVICE = "server_function";

function serverFunctionAttributes(
  request: Request | undefined,
  serverFnMeta: ServerFunctionMeta | undefined,
): Attributes {
  return {
    ...(serverFnMeta
      ? { "rpc.method": `${RPC_SERVICE}/${serverFnMeta.name}` }
      : {}),
    "rpc.system.name": "tanstack-start",
    ...(request ? { "url.path": parameterizeServerFunctionPath(request) } : {}),
  };
}

function parameterizeServerFunctionPath(request: Request) {
  const pathname = new URL(request.url).pathname;
  return serverRouteTemplate(pathname) ?? pathname;
}
