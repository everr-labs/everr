import { type ExportResult, ExportResultCode } from "@opentelemetry/core";
import { JsonLogsSerializer, JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { invoke } from "@tauri-apps/api/core";

// The webview cannot reach the collector directly, so we serialize a real OTLP
// request here and hand the encoded bytes to Rust, which forwards them verbatim
// (see proxy_otlp). Rust never decodes telemetry, so trace context, resource,
// scope, and severity survive intact — that is what keeps errors trace-linked.
type OtlpSignal = "logs" | "traces";

const decoder = new TextDecoder();

async function proxyOtlp(
  signal: OtlpSignal,
  payload: Uint8Array | undefined,
  resultCallback: (result: ExportResult) => void,
): Promise<void> {
  if (!payload || payload.length === 0) {
    resultCallback({ code: ExportResultCode.SUCCESS });
    return;
  }

  try {
    // OTLP/JSON is UTF-8 text; pass it as a string and Rust POSTs it as-is.
    await invoke("proxy_otlp", { signal, body: decoder.decode(payload) });
    resultCallback({ code: ExportResultCode.SUCCESS });
  } catch (error) {
    resultCallback({ code: ExportResultCode.FAILED, error: error as Error });
  }
}

export class OtlpProxyLogExporter implements LogRecordExporter {
  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    void proxyOtlp("logs", JsonLogsSerializer.serializeRequest(logs), resultCallback);
  }

  async shutdown(): Promise<void> {}

  async forceFlush(): Promise<void> {}
}

export class OtlpProxySpanExporter implements SpanExporter {
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    void proxyOtlp("traces", JsonTraceSerializer.serializeRequest(spans), resultCallback);
  }

  async shutdown(): Promise<void> {}
}
