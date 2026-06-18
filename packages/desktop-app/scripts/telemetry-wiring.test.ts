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

  it("forwards logs and spans through the OTLP proxy without web auto-instrumentation", () => {
    const telemetry = readSource("src/lib/telemetry.ts");
    const proxyExporter = readSource("src/lib/otlp-proxy-exporter.ts");

    expect(telemetry).toContain("LoggerProvider");
    expect(telemetry).toContain("BatchLogRecordProcessor");
    expect(telemetry).toContain("@everr/auto-otel-errors/browser");
    expect(telemetry).toContain("initErrorTracking");
    expect(telemetry).toContain("OtlpProxyLogExporter");

    // Spans go through the same passthrough proxy — no full web tracing.
    expect(telemetry).toContain("BasicTracerProvider");
    expect(telemetry).toContain("BatchSpanProcessor");
    expect(telemetry).toContain("OtlpProxySpanExporter");

    // The proxy serializes real OTLP/JSON and hands it to Rust untouched; Rust
    // does not reconstruct records, so trace context survives.
    expect(proxyExporter).toContain("JsonLogsSerializer");
    expect(proxyExporter).toContain("JsonTraceSerializer");
    expect(proxyExporter).toContain('invoke("proxy_otlp"');
    expect(proxyExporter).not.toContain("everr.browser.error");

    expect(telemetry).not.toContain("WebTracerProvider");
    expect(telemetry).not.toContain("getWebAutoInstrumentations");
    expect(telemetry).not.toContain("registerInstrumentations");
    expect(telemetry).not.toContain("W3CTraceContextPropagator");
    expect(telemetry).not.toContain("instrumentation-user-interaction");
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
