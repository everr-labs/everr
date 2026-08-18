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
        run: (span: {
          end: () => void;
          setAttribute: () => void;
        }) => Promise<unknown>,
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
// with it) into the test environment; server function paths only exercise the
// /_serverFn prefix rule, which needs no tree.
vi.mock("./server-router", async () => {
  const { routeTemplate } = await import("./route-template");
  const matcher = {
    matchRoutes: () => [{ routeId: "__root__", fullPath: "/" }],
  };
  return {
    serverRouteTemplate: (pathname: string) => routeTemplate(matcher, pathname),
  };
});

import { instrumentServerFunction } from "./server-fn-runtime";

describe("instrumentServerFunction", () => {
  beforeEach(() => {
    telemetryMocks.captureError.mockClear();
    telemetryMocks.startActiveSpan.mockClear();
    telemetryMocks.span.end.mockClear();
    telemetryMocks.span.setAttribute.mockClear();
  });

  it("records unexpected errors before TanStack serializes them into serverFn responses", async () => {
    const error = new Error("database unavailable");

    await expect(
      instrumentServerFunction(
        new Request("http://localhost/_serverFn/c4d3d0c28997f144965eeaca"),
        {
          filename: "src/lib/auth.server.ts",
          id: "c4d3d0c28997f144965eeaca",
          name: "getActiveOrganization",
        },
        () => {
          throw error;
        },
      ),
    ).rejects.toThrow("database unavailable");

    expect(telemetryMocks.captureError).toHaveBeenCalledWith(error, {
      "everr.error.source": "server_fn",
      "rpc.method": "server_function/getActiveOrganization",
      "rpc.system.name": "tanstack-start",
      "url.path": "/_serverFn/:id",
    });
    expect(telemetryMocks.startActiveSpan).toHaveBeenCalledWith(
      "tanstack.server_fn",
      {
        attributes: {
          "rpc.method": "server_function/getActiveOrganization",
          "rpc.system.name": "tanstack-start",
          "url.path": "/_serverFn/:id",
        },
        kind: 1,
      },
      expect.any(Function),
    );
    expect(telemetryMocks.span.end).toHaveBeenCalledOnce();
  });

  it.each([
    "Unauthenticated",
    "No active organization",
    "Alert not found",
  ])("does not record expected serverFn control-flow errors: %s", async (message) => {
    await expect(
      instrumentServerFunction(
        new Request("http://localhost/_serverFn/c4d3d0c28997f144965eeaca"),
        {
          filename: "src/lib/auth.server.ts",
          id: "c4d3d0c28997f144965eeaca",
          name: "getActiveOrganization",
        },
        () => {
          throw new Error(message);
        },
      ),
    ).rejects.toThrow(message);

    expect(telemetryMocks.captureError).not.toHaveBeenCalled();
    expect(telemetryMocks.span.end).toHaveBeenCalledOnce();
  });

  it("parameterizes TanStack dev serverFn IDs in serverFn span attributes", async () => {
    await instrumentServerFunction(
      new Request(
        "http://localhost/_serverFn/eyJmaWxlIjoiL3NyYy9yb3V0ZXMvX19yb290LnRzeD90c3Mtc2VydmVyZm4tc3BsaXQiLCJleHBvcnQiOiJnZXRTZXNzaW9uX2NyZWF0ZVNlcnZlckZuX2hhbmRsZXIifQ",
      ),
      {
        filename: "src/routes/__root.tsx",
        id: "eyJmaWxlIjoiL3NyYy9yb3V0ZXMvX19yb290LnRzeD90c3Mtc2VydmVyZm4tc3BsaXQiLCJleHBvcnQiOiJnZXRTZXNzaW9uX2NyZWF0ZVNlcnZlckZuX2hhbmRsZXIifQ",
        name: "getSession",
      },
      () => "ok",
    );

    expect(telemetryMocks.startActiveSpan).toHaveBeenCalledWith(
      "tanstack.server_fn",
      {
        attributes: {
          "rpc.method": "server_function/getSession",
          "rpc.system.name": "tanstack-start",
          "url.path": "/_serverFn/:id",
        },
        kind: 1,
      },
      expect.any(Function),
    );
  });
});
