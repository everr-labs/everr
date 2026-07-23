// The SDK's own emit pipeline: an in-memory queue, a batch timer, and one
// fetch POST of OTLP JSON per flush. Owning the queue (instead of OTel's
// BatchLogRecordProcessor) is what lets the exit-flush work prioritize and
// truncate by event name later. Wire shapes follow the OTLP JSON mapping
// (intValue is a decimal string).

export type AttrValue = string | number | boolean;

type AnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };

type KeyValue = { key: string; value: AnyValue };

type OtlpLogRecord = {
  timeUnixNano: string;
  severityNumber: number;
  eventName: string;
  attributes: KeyValue[];
};

export type Emitter = {
  /**
   * `exitPriority` ranks the record for exit truncation: lower survives
   * longer (errors 0 > page_leave 1 > vitals 2 > interactions 3, the
   * default). Signals declare their own rank at the emit site.
   */
  emit(
    eventName: string,
    attributes?: Record<string, AttrValue | undefined>,
    exitPriority?: number,
  ): void;
  flush(): Promise<void>;
  /**
   * Exit-path flush: fetch keepalive, with the payload truncated to the
   * keepalive budget by per-signal priority.
   */
  exitFlush(): void;
  shutdown(): Promise<void>;
};

// Same tuning as the web app's browser telemetry client.
const MAX_QUEUE_SIZE = 100;
const MAX_BATCH_SIZE = 32;
const SCHEDULED_DELAY_MS = 5_000;

// The keepalive in-flight quota, measured in actual bytes (multibyte
// attribute values would make string length undercount).
const EXIT_BUDGET = 64_000;

export const noop = () => Promise.resolve();

function toAnyValue(value: AttrValue): AnyValue {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return Number.isInteger(value)
    ? { intValue: String(value) }
    : { doubleValue: value };
}

function toKeyValues(
  attributes: Record<string, AttrValue | undefined>,
): KeyValue[] {
  // Skipping undefined lets callers write optional attributes as plain
  // properties instead of conditional spreads.
  return Object.entries(attributes).flatMap(([key, value]) =>
    value === undefined ? [] : [{ key, value: toAnyValue(value) }],
  );
}

export function createEmitter(options: {
  logsUrl: string;
  headers?: Record<string, string>;
  resource: Record<string, AttrValue | undefined>;
  scope: { name: string; version: string };
  /** Called per record; returns the context envelope to stamp. */
  envelope: () => Record<string, AttrValue | undefined>;
}): Emitter {
  const resource = toKeyValues(options.resource);
  const headers = { "Content-Type": "application/json", ...options.headers };
  let queue: Array<{ p: number; r: OtlpLogRecord }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const build = () =>
    JSON.stringify({
      resourceLogs: [
        {
          resource: { attributes: resource },
          scopeLogs: [
            { scope: options.scope, logRecords: queue.map((q) => q.r) },
          ],
        },
      ],
    });

  const takeBody = (): string | undefined => {
    clearTimeout(timer);
    timer = undefined;
    if (!queue.length) return undefined;
    const body = build();
    queue = [];
    return body;
  };

  // Telemetry must never break the page: delivery is best-effort, sync
  // throws included. The global fetch is read at call time, which is also
  // what the tests stub. keepalive survives the page teardown; deliberately
  // no sendBeacon fallback (it cannot carry the Authorization header, so it
  // could never deliver to the hosted ingest anyway).
  const post = (body: string, keepalive?: boolean): Promise<void> => {
    try {
      return fetch(options.logsUrl, {
        method: "POST",
        headers,
        body,
        keepalive,
      }).then(noop, noop);
    } catch {
      return noop();
    }
  };

  const flush = (): Promise<void> => {
    const body = takeBody();
    return body ? post(body) : noop();
  };

  const exitFlush = (): void => {
    // Truncate whole records, lowest priority first, until the batch fits
    // the keepalive budget.
    queue.sort((a, b) => a.p - b.p);
    while (queue.length > 1 && new Blob([build()]).size > EXIT_BUDGET)
      queue.pop();
    const body = takeBody();
    if (body) void post(body, true);
  };

  return {
    emit(eventName, attributes, exitPriority = 3) {
      if (queue.length >= MAX_QUEUE_SIZE) return;
      queue.push({
        p: exitPriority,
        r: {
          timeUnixNano: `${Date.now()}000000`,
          severityNumber: 9, // INFO
          eventName,
          attributes: toKeyValues({ ...options.envelope(), ...attributes }),
        },
      });
      if (queue.length >= MAX_BATCH_SIZE) {
        void flush();
      } else {
        timer ??= setTimeout(() => void flush(), SCHEDULED_DELAY_MS);
      }
    },
    flush,
    exitFlush,
    shutdown: flush,
  };
}
