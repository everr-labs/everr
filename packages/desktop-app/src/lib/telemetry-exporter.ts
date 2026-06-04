import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import { invoke } from "@tauri-apps/api/core";

type BrowserErrorLogBody =
  | "everr.browser.error"
  | "everr.browser.unhandled_rejection"
  | "everr.react.render.error";

type RelayLogRecord = {
  body: BrowserErrorLogBody;
  attributes: Record<string, string | boolean | number>;
};

function isBrowserErrorLogBody(body: string): body is BrowserErrorLogBody {
  return (
    body === "everr.browser.error" ||
    body === "everr.browser.unhandled_rejection" ||
    body === "everr.react.render.error"
  );
}

function relayAttributeValue(
  value: unknown,
): string | boolean | number | undefined {
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  return undefined;
}

function toRelayLogRecord(record: ReadableLogRecord): RelayLogRecord | null {
  const body = String(record.body ?? "");
  if (!isBrowserErrorLogBody(body)) {
    return null;
  }

  const attributes: RelayLogRecord["attributes"] = {};
  for (const [key, value] of Object.entries(record.attributes ?? {})) {
    const relayValue = relayAttributeValue(value);
    if (relayValue !== undefined) {
      attributes[key] = relayValue;
    }
  }

  return { body, attributes };
}

// export/shutdown/forceFlush below are called by BatchLogRecordProcessor through
// the LogRecordExporter interface at runtime; see usedClassMembers in .fallowrc.jsonc.
export class TauriLogExporter implements LogRecordExporter {
  async export(
    logs: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void,
  ): Promise<void> {
    const records = logs
      .map(toRelayLogRecord)
      .filter((record): record is RelayLogRecord => record !== null);

    if (records.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    try {
      await invoke("relay_telemetry", { signal: "logs", records });
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: error as Error,
      });
    }
  }

  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}
