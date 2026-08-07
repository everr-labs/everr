import { errors, WebSDK } from "@everr/otel-web";
import { invoke } from "@tauri-apps/api/core";

// Renderer telemetry rides @everr/otel-web with a host-owned transport. The
// webview cannot reach the collector directly, so the SDK hands each OTLP/JSON
// payload to Rust, which forwards the bytes verbatim to
// `{endpoint}/v1/{signal}` with the configured headers (see proxy_otlp). Rust
// never decodes telemetry, so resource, scope, severity, and trace context
// survive intact.
//
// Only Rust reads exporter configuration: `ingestKey`, `endpoint`, and `dev`
// are unused here, and `send` makes the SDK issue no request of its own.
type TelemetryContext = {
  serviceName: string;
  serviceVersion: string;
  serviceInstanceId: string;
  deploymentEnvironment: string;
};

let client: WebSDK | null = null;

async function initBrowserTelemetry() {
  const telemetryContext = await invoke<TelemetryContext>(
    "get_telemetry_context",
  );

  client = new WebSDK({
    serviceName: telemetryContext.serviceName,
    serviceVersion: telemetryContext.serviceVersion,
    serviceInstanceId: telemetryContext.serviceInstanceId,
    deploymentEnvironment: telemetryContext.deploymentEnvironment,
    send: (signal, body) => invoke("proxy_otlp", { signal, body }),
    // Errors only: the desktop shell has no page views to report, and the
    // instrumentation owns the window error/unhandledrejection handlers so nothing
    // here registers its own (that would double-capture).
    instrumentations: [errors()],
  });
}

void initBrowserTelemetry();

// The SDK already flushes on pagehide and on visibilitychange-hidden. A Tauri
// window close does not reliably fire either, so the last batch is flushed
// here too; flush (not shutdown) keeps capture alive if the close is aborted.
window.addEventListener("beforeunload", () => {
  void client?.flush();
});
