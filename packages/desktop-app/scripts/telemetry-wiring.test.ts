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

  it("configures browser telemetry as logs-only", () => {
    const telemetry = readSource("src/lib/telemetry.ts");
    const exporter = readSource("src/lib/telemetry-exporter.ts");
    const packageJson = readSource("package.json");

    expect(telemetry).toContain("LoggerProvider");
    expect(telemetry).toContain("BatchLogRecordProcessor");
    expect(telemetry).toContain("everr.browser.error");
    expect(telemetry).toContain("everr.browser.unhandled_rejection");
    expect(exporter).toContain("TauriLogExporter");
    expect(exporter).toContain("toRelayLogRecord");
    expect(exporter).toContain('invoke("relay_telemetry", { signal: "logs", records })');
    expect(exporter).not.toContain("TauriSpanExporter");
    expect(exporter).not.toContain("JsonLogsSerializer");
    expect(telemetry).not.toContain("WebTracerProvider");
    expect(telemetry).not.toContain("BatchSpanProcessor");
    expect(telemetry).not.toContain("getWebAutoInstrumentations");
    expect(telemetry).not.toContain("registerInstrumentations");
    expect(telemetry).not.toContain("W3CTraceContextPropagator");
    expect(telemetry).not.toContain("instrumentation-user-interaction");
    expect(packageJson).not.toContain('"@opentelemetry/auto-instrumentations-web"');
    expect(packageJson).not.toContain('"@opentelemetry/sdk-trace-web"');
    expect(packageJson).not.toContain('"@opentelemetry/instrumentation"');
    expect(packageJson).not.toContain('"@opentelemetry/plugin-react-load"');
    expect(packageJson).not.toContain('"@opentelemetry/otlp-transformer"');
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
