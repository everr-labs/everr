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

vi.mock("@everr/otel-errors", () => ({
  captureError: telemetryMocks.captureError,
}));

vi.mock("@opentelemetry/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@opentelemetry/api")>()),
  trace: {
    getTracer: () => ({ startActiveSpan: telemetryMocks.startActiveSpan }),
  },
}));

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
      "everr.server_function.name": "getActiveOrganization",
      "everr.server_function.transport": "http",
    });
    expect(telemetryMocks.startActiveSpan).toHaveBeenCalledWith(
      "serverFn getActiveOrganization",
      {
        attributes: {
          "everr.server_function.name": "getActiveOrganization",
          "everr.server_function.transport": "http",
        },
        kind: 0,
      },
      expect.any(Function),
    );
    expect(telemetryMocks.span.end).toHaveBeenCalledOnce();
  });

  it("does not record errors the isExpectedError predicate accepts", async () => {
    const message = "Unauthenticated";

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
        { isExpectedError: (error) => (error as Error).message === message },
      ),
    ).rejects.toThrow(message);

    expect(telemetryMocks.captureError).not.toHaveBeenCalled();
    expect(telemetryMocks.span.end).toHaveBeenCalledOnce();
  });

    it("names the span after the function", async () => {
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
      "serverFn getSession",
      {
        attributes: {
          "everr.server_function.name": "getSession",
          "everr.server_function.transport": "http",
        },
        kind: 0,
      },
      expect.any(Function),
    );
  });
});
