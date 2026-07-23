// Minimal OTLP/HTTP JSON encoding for log records: the same wire format the
// OTel exporter produced, hand-rolled so the SDK ships no OTel runtime.
// Shapes follow the OTLP JSON mapping (intValue is a decimal string).

export type AttrValue = string | number | boolean;

type AnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };

export type KeyValue = { key: string; value: AnyValue };

export type OtlpLogRecord = {
  timeUnixNano: string;
  severityNumber: number;
  eventName: string;
  attributes: KeyValue[];
};

export function toKeyValues(attributes: Record<string, AttrValue>): KeyValue[] {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: toAnyValue(value),
  }));
}

export function buildLogsPayload(
  resourceAttributes: KeyValue[],
  scope: { name: string; version: string },
  logRecords: OtlpLogRecord[],
): unknown {
  return {
    resourceLogs: [
      {
        resource: { attributes: resourceAttributes },
        scopeLogs: [{ scope, logRecords }],
      },
    ],
  };
}

function toAnyValue(value: AttrValue): AnyValue {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return Number.isInteger(value)
    ? { intValue: String(value) }
    : { doubleValue: value };
}
