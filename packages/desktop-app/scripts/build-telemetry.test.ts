import { describe, expect, it } from "vitest";
import {
  buildOtlpTracePayload,
  buildTelemetryResourceAttributes,
  createBuildTelemetry,
  deriveCiJobSpanId,
  deriveCiRunRootSpanId,
  deriveCiTraceId,
  resolveBuildTelemetryExport,
  resolveBuildTraceContext,
} from "./build-telemetry";

// Fixed vectors generated from the Go derivations in
// collector/receiver/githubactionsreceiver/trace_event_handling.go; the
// receiver's build_telemetry_vectors_test.go pins the same values so drift on
// either side fails its own suite.
describe("CI trace id derivation", () => {
  it("matches the collector receiver's generateTraceID", () => {
    expect(deriveCiTraceId("123456", "9876543210", "1")).toBe(
      "ce3e4cc4a1ed6e03e580b6b9174acdbf",
    );
  });

  it("matches the collector receiver's generateParentSpanID", () => {
    expect(deriveCiRunRootSpanId("9876543210", "1")).toBe("00e6b232dd4f2fd7");
  });

  it("matches the collector receiver's generateJobSpanID", () => {
    expect(deriveCiJobSpanId("9876543210", "1", "Build, Sign, Notarize Desktop")).toBe(
      "fb1a2fcb5d794586",
    );
  });
});

describe("resolveBuildTraceContext", () => {
  const ciEnv = {
    GITHUB_REPOSITORY_ID: "123456",
    GITHUB_RUN_ID: "9876543210",
    GITHUB_RUN_ATTEMPT: "1",
  };

  it("prefers explicit child-script trace context", () => {
    const context = resolveBuildTraceContext({
      ...ciEnv,
      EVERR_BUILD_TRACE_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      EVERR_BUILD_PARENT_SPAN_ID: "bbbbbbbbbbbbbbbb",
    });
    expect(context).toEqual({
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      parentSpanId: "bbbbbbbbbbbbbbbb",
      source: "child-script",
    });
  });

  it("parents under the job span when the job name is known", () => {
    const context = resolveBuildTraceContext({
      ...ciEnv,
      EVERR_CI_JOB_NAME: "Build, Sign, Notarize Desktop",
    });
    expect(context.traceId).toBe("ce3e4cc4a1ed6e03e580b6b9174acdbf");
    expect(context.parentSpanId).toBe("fb1a2fcb5d794586");
    expect(context.source).toBe("github-actions");
  });

  it("falls back to the workflow run root span without a job name", () => {
    const context = resolveBuildTraceContext(ciEnv);
    expect(context.parentSpanId).toBe("00e6b232dd4f2fd7");
  });

  it("uses a random root trace outside CI", () => {
    const context = resolveBuildTraceContext({});
    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(context.parentSpanId).toBeUndefined();
    expect(context.source).toBe("local");
  });
});

describe("resolveBuildTelemetryExport", () => {
  it("uses hosted ingest with a bearer header in CI when EVERR_INGEST_KEY is set", () => {
    const target = resolveBuildTelemetryExport({
      EVERR_INGEST_KEY: "test-key",
      GITHUB_ACTIONS: "true",
    });
    expect(target?.url).toBe("https://ingest.everr.dev/v1/traces");
    expect(target?.headers.authorization).toBe("Bearer test-key");
  });

  it("skips export entirely in CI without an ingest key", () => {
    expect(resolveBuildTelemetryExport({ GITHUB_ACTIONS: "true" })).toBeNull();
  });

  it("keeps local builds on the local collector even with an ingest key", () => {
    const target = resolveBuildTelemetryExport({ EVERR_INGEST_KEY: "test-key" });
    expect(target?.url).toBe("http://127.0.0.1:54318/v1/traces");
    expect(target?.headers.authorization).toBeUndefined();
  });

  it("uses an explicit endpoint verbatim without auth", () => {
    const target = resolveBuildTelemetryExport({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318/",
      EVERR_INGEST_KEY: "test-key",
      GITHUB_ACTIONS: "true",
    });
    expect(target?.url).toBe("http://127.0.0.1:4318/v1/traces");
    expect(target?.headers.authorization).toBeUndefined();
  });

  it("falls back to the local collector", () => {
    const target = resolveBuildTelemetryExport({});
    expect(target?.url).toBe("http://127.0.0.1:54318/v1/traces");
    expect(target?.headers.authorization).toBeUndefined();
  });
});

describe("buildTelemetryResourceAttributes", () => {
  it("identifies CI builds with vcs and pipeline attributes", () => {
    const attributes = buildTelemetryResourceAttributes({
      GITHUB_ACTIONS: "true",
      GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
      GITHUB_REPOSITORY: "everr-labs/everr",
      GITHUB_REF_NAME: "@everr/desktop-app@1.2.3",
      GITHUB_RUN_ID: "9876543210",
      EVERR_CI_JOB_NAME: "Build, Sign, Notarize Desktop",
    });
    expect(attributes["service.name"]).toBe("github-actions");
    expect(attributes["service.namespace"]).toBe("cicd");
    expect(attributes["deployment.environment.name"]).toBe("ci");
    expect(attributes["service.version"]).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(attributes["vcs.repository.name"]).toBe("everr-labs/everr");
    expect(attributes["cicd.pipeline.run.id"]).toBe("9876543210");
    expect(attributes["cicd.pipeline.task.name"]).toBe("Build, Sign, Notarize Desktop");
  });

  it("marks local builds as development under their own service name", () => {
    const attributes = buildTelemetryResourceAttributes({});
    expect(attributes["service.name"]).toBe("everr-desktop-build");
    expect(attributes["service.namespace"]).toBe("everr");
    expect(attributes["deployment.environment.name"]).toBe("development");
    expect(attributes["service.version"]).toBe("local-dev");
  });
});

describe("createBuildTelemetry", () => {
  it("records phases as children of the root span and exposes child env", async () => {
    const env = {
      GITHUB_REPOSITORY_ID: "123456",
      GITHUB_RUN_ID: "9876543210",
      GITHUB_RUN_ATTEMPT: "1",
      EVERR_CI_JOB_NAME: "Build, Sign, Notarize Desktop",
    };
    const telemetry = createBuildTelemetry({ buildName: "desktop release build", env });

    let phaseChildEnv: Record<string, string> | undefined;
    await expect(
      telemetry.phase("build tauri app", async (span) => {
        phaseChildEnv = span.childEnv();
        return "ok";
      }),
    ).resolves.toBe("ok");
    expect(phaseChildEnv?.EVERR_BUILD_TRACE_ID).toBe("ce3e4cc4a1ed6e03e580b6b9174acdbf");
    expect(phaseChildEnv?.EVERR_BUILD_PARENT_SPAN_ID).toMatch(/^[0-9a-f]{16}$/);
    await expect(
      telemetry.phase("notarize dmg", async () => {
        throw new Error("notarytool exploded");
      }),
    ).rejects.toThrow("notarytool exploded");
  });

  it("marks the phase span as errored in the OTLP payload", async () => {
    const telemetry = createBuildTelemetry({ buildName: "cli release build", env: {} });
    await telemetry
      .phase("build cli", async () => {
        throw new Error("cargo failed");
      })
      .catch(() => {});

    const payload = capturePayload(telemetry);
    const spans = (await payload).resourceSpans[0].scopeSpans[0].spans;
    const failed = spans.find((span) => span.name === "build cli");
    expect(failed?.status).toEqual({ code: 2, message: "cargo failed" });
    const root = spans.find((span) => span.name === "cli release build");
    expect(root?.status.code).toBe(1);
    expect(root?.parentSpanId).toBeUndefined();
  });
});

async function capturePayload(telemetry: {
  flush(error?: unknown): Promise<void>;
}): Promise<ReturnType<typeof buildOtlpTracePayload>> {
  const originalFetch = globalThis.fetch;
  let captured: ReturnType<typeof buildOtlpTracePayload> | undefined;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    captured = JSON.parse(String(init?.body));
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  try {
    await telemetry.flush();
  } finally {
    globalThis.fetch = originalFetch;
  }
  if (!captured) {
    throw new Error("flush did not export a payload");
  }
  return captured;
}
