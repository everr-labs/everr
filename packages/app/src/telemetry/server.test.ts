import { beforeEach, describe, expect, it, vi } from "vitest";

const telemetryMocks = vi.hoisted(() => {
  const span = {
    end: vi.fn(),
    setAttribute: vi.fn(),
    updateName: vi.fn(),
  };

  return {
    captureError: vi.fn(),
    startActiveSpan: vi.fn(
      async (
        _name: string,
        _options: unknown,
        _context: unknown,
        run: (span: {
          end: () => void;
          setAttribute: () => void;
        }) => Promise<Response>,
      ) => run(span),
    ),
    span,
  };
});

vi.mock("./node", () => ({
  captureError: telemetryMocks.captureError,
  getTelemetryTracer: () => ({
    startActiveSpan: telemetryMocks.startActiveSpan,
  }),
  SpanKind: { SERVER: 1 },
}));

// The real router pulls the whole generated route tree (and the server env
// with it) into the test environment, so stub the factory with a two-route
// matcher. The real `routeTemplate` derivation still runs.
// test-setup mocks @tanstack/react-start with a function-middleware shape
// (`__handler`). Request middleware exposes `options.server`, which is what
// Start actually calls, so use the real module here.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
}));

vi.mock("@/router", () => ({
  getRouter: () => ({
    matchRoutes: (pathname: string) =>
      pathname === "/api/cli/sql"
        ? [
            { routeId: "__root__", fullPath: "/" },
            { routeId: "/api/cli/sql", fullPath: "/api/cli/sql" },
          ]
        : [{ routeId: "__root__", fullPath: "/" }],
  }),
}));

import { requestTelemetryMiddleware } from "./server";
import { recordServerFunctionName } from "./server-fn-name";

// Drive the middleware the way Start does: it passes the request, the
// pathname, and the handler kind, and `next` yields the downstream response.
async function runRequest(
  request: Request,
  respond: () => Response | Promise<Response>,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const server = requestTelemetryMiddleware.options.server;
  if (!server) throw new Error("middleware has no server handler");
  const result = await server({
    request,
    pathname,
    handlerType: pathname.startsWith("/_serverFn/") ? "serverFn" : "router",
    context: {},
    next: async () => ({ response: await respond() }),
  } as never);
  return (result as { response: Response }).response;
}

describe("requestTelemetryMiddleware", () => {
  beforeEach(() => {
    telemetryMocks.captureError.mockClear();
    telemetryMocks.startActiveSpan.mockClear();
    telemetryMocks.span.end.mockClear();
    telemetryMocks.span.setAttribute.mockClear();
    telemetryMocks.span.updateName.mockClear();
  });

  it("records 5xx responses as server response errors", async () => {
    const response = await runRequest(
      new Request("http://localhost/api/cli/sql", { method: "POST" }),
      () => new Response("{}", { status: 500 }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-everr-route")).toBe("/api/cli/sql");
    expect(telemetryMocks.captureError).toHaveBeenCalledWith(
      expect.any(Error),
      {
        "everr.error.source": "server.response",
        "http.request.method": "POST",
        "http.response.status_code": 500,
        "http.route": "/api/cli/sql",
        "url.path": "/api/cli/sql",
      },
    );
    expect(telemetryMocks.span.end).toHaveBeenCalledOnce();
  });

  it("names an unmatched path by method only, with no http.route", async () => {
    const response = await runRequest(
      new Request("http://localhost/wp-login.php"),
      () => new Response("{}", { status: 200 }),
    );
    expect(response.headers.get("x-everr-route")).toBeNull();

    expect(telemetryMocks.startActiveSpan).toHaveBeenCalledWith(
      "GET",
      {
        attributes: {
          "http.request.method": "GET",
          "url.path": "/wp-login.php",
          "url.scheme": "http",
        },
        kind: 1,
      },
      expect.anything(),
      expect.any(Function),
    );
  });

  it("parameterizes TanStack dev serverFn IDs in server span names and attributes", async () => {
    await runRequest(
      new Request(
        "http://localhost/_serverFn/eyJmaWxlIjoiL3NyYy9yb3V0ZXMvX19yb290LnRzeD90c3Mtc2VydmVyZm4tc3BsaXQiLCJleHBvcnQiOiJnZXRTZXNzaW9uX2NyZWF0ZVNlcnZlckZuX2hhbmRsZXIifQ",
      ),
      () => new Response("{}", { status: 200 }),
    );

    expect(telemetryMocks.startActiveSpan).toHaveBeenCalledWith(
      "GET /_serverFn/:id",
      {
        attributes: {
          "http.request.method": "GET",
          "http.route": "/_serverFn/:id",
          "url.path":
            "/_serverFn/eyJmaWxlIjoiL3NyYy9yb3V0ZXMvX19yb290LnRzeD90c3Mtc2VydmVyZm4tc3BsaXQiLCJleHBvcnQiOiJnZXRTZXNzaW9uX2NyZWF0ZVNlcnZlckZuX2hhbmRsZXIifQ",
          "url.scheme": "http",
        },
        kind: 1,
      },
      expect.anything(),
      expect.any(Function),
    );
  });

  it("renames the span and the route echo after the middleware reports the function name", async () => {
    const response = await runRequest(
      new Request("http://localhost/_serverFn/c4d3d0c28997f144965eeaca", {
        method: "POST",
      }),
      () => {
        // The middleware runs inside the wrapper's context and reports the
        // name it read from serverFnMeta.
        recordServerFunctionName("getSession");
        return new Response("{}", { status: 200 });
      },
    );

    expect(telemetryMocks.span.updateName).toHaveBeenCalledWith(
      "POST /_serverFn/getSession",
    );
    expect(telemetryMocks.span.setAttribute).toHaveBeenCalledWith(
      "http.route",
      "/_serverFn/getSession",
    );
    expect(response.headers.get("x-everr-route")).toBe("/_serverFn/getSession");
  });

  it("keeps the /_serverFn/:id fallback when no name is reported", async () => {
    const response = await runRequest(
      new Request("http://localhost/_serverFn/c4d3d0c28997f144965eeaca"),
      () => new Response("{}", { status: 200 }),
    );

    expect(telemetryMocks.span.updateName).not.toHaveBeenCalled();
    expect(response.headers.get("x-everr-route")).toBe("/_serverFn/:id");
  });
});
