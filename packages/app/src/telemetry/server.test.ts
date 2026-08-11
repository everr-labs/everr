import { beforeEach, describe, expect, it, vi } from "vitest";

const telemetryMocks = vi.hoisted(() => {
  const span = {
    end: vi.fn(),
    setAttribute: vi.fn(),
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

// The real matcher pulls the whole generated route tree (and the server env
// with it) into the test environment, so stub it with the shared derivation
// over a two-route tree.
vi.mock("./server-router", async () => {
  const { routeTemplate } = await import("./route-template");
  const matcher = {
    matchRoutes: (pathname: string) =>
      pathname === "/api/cli/sql"
        ? [{ routeId: "__root__" }, { routeId: "/api/cli/sql" }]
        : [{ routeId: "__root__" }],
  };
  return {
    serverRouteTemplate: (pathname: string) => routeTemplate(matcher, pathname),
  };
});

import { instrumentServerFetch } from "./server";

describe("instrumentServerFetch", () => {
  beforeEach(() => {
    telemetryMocks.captureError.mockClear();
    telemetryMocks.startActiveSpan.mockClear();
    telemetryMocks.span.end.mockClear();
    telemetryMocks.span.setAttribute.mockClear();
  });

  it("records 5xx responses as server response errors", async () => {
    const response = await instrumentServerFetch(
      new Request("http://localhost/api/cli/sql", { method: "POST" }),
      () => new Response("{}", { status: 500 }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-everr-route")).toBe("/api/cli/sql");
    expect(telemetryMocks.captureError).toHaveBeenCalledWith(
      expect.any(Error),
      {
        "error.source": "server.response",
        "http.request.method": "POST",
        "http.response.status_code": 500,
        "http.route": "/api/cli/sql",
        "url.path": "/api/cli/sql",
      },
    );
    expect(telemetryMocks.span.end).toHaveBeenCalledOnce();
  });

  it("names an unmatched path by method only, with no http.route", async () => {
    const response = await instrumentServerFetch(
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
    await instrumentServerFetch(
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
});
