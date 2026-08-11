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
          "url.path": "/_serverFn/:id",
          "url.scheme": "http",
        },
        kind: 1,
      },
      expect.anything(),
      expect.any(Function),
    );
  });
});
