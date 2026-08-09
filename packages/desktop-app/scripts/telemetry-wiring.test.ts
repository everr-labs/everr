import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string) {
  return readFileSync(path.join(appDir, relativePath), "utf8");
}

describe("desktop browser telemetry wiring", () => {
  it("loads telemetry before rendering the React app", () => {
    const main = readSource("src/main.tsx");
    const telemetryImport = main.indexOf('import "./lib/telemetry";');
    const render = main.indexOf("ReactDOM.createRoot");

    expect(telemetryImport).toBeGreaterThanOrEqual(0);
    expect(telemetryImport).toBeLessThan(render);
  });

  it("forwards every signal through the OTLP proxy with the SDK's host transport", () => {
    const telemetry = readSource("src/lib/telemetry.ts");

    // The SDK builds OTLP/JSON itself and hands the payload to Rust through
    // `send`, so there is no exporter, no provider, and no serializer here.
    expect(telemetry).toContain('from "@everr/otel-web"');
    expect(telemetry).toContain("send:");
    expect(telemetry).toContain('invoke("proxy_otlp", { signal, body })');

    // Errors are the one capture source, and the instrumentation owns the window
    // handlers: a hand-rolled listener alongside it would double-capture.
    expect(telemetry).toContain("errors()");
    expect(telemetry).not.toContain("addEventListener(\"error\"");
    expect(telemetry).not.toContain("onunhandledrejection");

    // No OTel SDK in the renderer at all: that whole layer moved into the
    // browser SDK, which ships far fewer bytes.
    expect(telemetry).not.toContain("@opentelemetry/");
    expect(telemetry).not.toContain("LoggerProvider");
    expect(telemetry).not.toContain("BatchLogRecordProcessor");
    expect(telemetry).not.toContain("BasicTracerProvider");
    expect(telemetry).not.toContain("WebTracerProvider");
    expect(telemetry).not.toContain("getWebAutoInstrumentations");
    expect(telemetry).not.toContain("registerInstrumentations");
    expect(telemetry).not.toContain("W3CTraceContextPropagator");
    expect(telemetry).not.toContain("instrumentation-user-interaction");
  });

  it("keeps the resource identity Rust reports", () => {
    const telemetry = readSource("src/lib/telemetry.ts");

    expect(telemetry).toContain('"get_telemetry_context"');
    for (const field of [
      "serviceName",
      "serviceVersion",
      "serviceInstanceId",
      "deploymentEnvironment",
    ]) {
      expect(telemetry).toContain(`${field}: telemetryContext.${field}`);
    }
  });

  it("does not wrap application commands in Tauri IPC spans", () => {
    const tauri = readSource("src/lib/tauri.ts");

    expect(tauri).toContain("return invoke<TResult>(command, args)");
    expect(tauri).not.toContain("trace.getTracer");
    expect(tauri).not.toContain("startActiveSpan");
    expect(tauri).not.toContain("propagation.inject");
    expect(tauri).not.toContain("rpc.system");
    expect(tauri).not.toContain("rpc.method");
  });
});
