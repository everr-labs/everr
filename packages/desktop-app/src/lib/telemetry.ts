import { errors, WebSDK } from "@everr/otel-web";
import { invoke } from "@tauri-apps/api/core";

// The telemetry of the renderer uses @everr/otel-web, and the host sends the
// data. The webview cannot connect to the collector directly. Thus the SDK gives
// each OTLP/JSON payload to the Rust code. That code sends the bytes without a
// change to `{endpoint}/v1/{signal}` with the configured headers. Refer to
// proxy_otlp. The Rust code never reads the content of the telemetry. Thus the
// resource, the scope, the severity, and the trace context do not change.
//
// Only the Rust code reads the configuration of the exporter. Thus this module
// does not use `ingestKey`, `endpoint`, and `dev`. The `send` option makes the
// SDK send no request of its own.
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
    // This app captures only the errors, because the desktop application has no
    // page views. The instrumentation owns the handlers for the window error
    // event and the unhandledrejection event. Thus this module registers no
    // handler of its own, because two handlers capture each error two times.
    instrumentations: [errors()],
  });
}

void initBrowserTelemetry();

// The SDK sends its records at the pagehide event and at the visibilitychange
// event with the hidden state. When Tauri closes a window, the two events do not
// always occur. Thus this code also sends the last batch. It calls flush and not
// shutdown. Thus the capture continues if the application cancels the close
// operation.
window.addEventListener("beforeunload", () => {
  void client?.flush();
});
