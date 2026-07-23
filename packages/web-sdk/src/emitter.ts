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
  emit(
    eventName: string,
    attributes?: Record<string, AttrValue | undefined>,
  ): void;
  flush(): Promise<void>;
  /**
   * Exit-path flush: fetch keepalive (sendBeacon fallback), with the payload
   * truncated to the keepalive budget by per-signal priority.
   */
  exitFlush(): void;
  shutdown(): Promise<void>;
};

// Same tuning as the web app's browser telemetry client.
const MAX_QUEUE_SIZE = 100;
const MAX_BATCH_SIZE = 32;
const SCHEDULED_DELAY_MS = 5_000;

// Exit truncation: lower survives longer. Unlisted browser.* events rank
// last; non-browser events (errors) rank first, so the order is
// errors > page_leave > vitals > interactions.
const EXIT_PRIORITY: Record<string, number> = {
  "browser.page_leave": 1,
  "browser.web_vital": 2,
};
const priority = (eventName: string) =>
  EXIT_PRIORITY[eventName] ?? (eventName.startsWith("browser.") ? 3 : 0);
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
  let queue: OtlpLogRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const build = () =>
    JSON.stringify({
      resourceLogs: [
        {
          resource: { attributes: resource },
          scopeLogs: [{ scope: options.scope, logRecords: queue }],
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

  const flush = (): Promise<void> => {
    const body = takeBody();
    if (!body) return Promise.resolve();
    // Telemetry must never break the page: delivery is best-effort. The
    // global fetch is read at flush time, which is also what the tests stub.
    return fetch(options.logsUrl, { method: "POST", headers, body }).then(
      noop,
      noop,
    );
  };

  const exitFlush = (): void => {
    // Truncate whole records, lowest priority first, until the batch fits
    // the keepalive budget.
    queue.sort((a, b) => priority(a.eventName) - priority(b.eventName));
    while (queue.length > 1 && new Blob([build()]).size > EXIT_BUDGET)
      queue.pop();
    const body = takeBody();
    if (!body) return;
    // keepalive survives the page teardown. Deliberately no sendBeacon
    // fallback: it cannot carry the Authorization header, so it could never
    // deliver to the hosted ingest anyway.
    try {
      void fetch(options.logsUrl, {
        method: "POST",
        headers,
        body,
        keepalive: true,
      }).then(noop, noop);
    } catch {
      // Telemetry must never break the page.
    }
  };

  return {
    emit(eventName, attributes) {
      if (queue.length >= MAX_QUEUE_SIZE) return;
      queue.push({
        timeUnixNano: `${Date.now()}000000`,
        severityNumber: 9, // INFO
        eventName,
        attributes: toKeyValues({ ...options.envelope(), ...attributes }),
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
