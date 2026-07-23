import {
  type AttrValue,
  buildLogsPayload,
  type KeyValue,
  type OtlpLogRecord,
  toKeyValues,
} from "./otlp.js";

// The SDK's own emit pipeline: an in-memory queue, a batch timer, and one
// fetch POST of OTLP JSON per flush. Owning the queue (instead of OTel's
// BatchLogRecordProcessor) is what lets the exit-flush work prioritize and
// truncate by event name later.

export type Emitter = {
  emit(eventName: string, attributes?: Record<string, AttrValue>): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
};

const SEVERITY_INFO = 9;
// Same tuning as the web app's browser telemetry client.
const MAX_QUEUE_SIZE = 100;
const MAX_BATCH_SIZE = 32;
const SCHEDULED_DELAY_MS = 5_000;

export function createEmitter(options: {
  logsUrl: string;
  headers: Record<string, string> | undefined;
  resource: Record<string, AttrValue>;
  scope: { name: string; version: string };
  /** Called per record; returns the context envelope to stamp. */
  envelope: () => Record<string, AttrValue>;
  /** Test seam; defaults to the global fetch. */
  transportFetch?: typeof fetch;
}): Emitter {
  const resourceAttributes: KeyValue[] = toKeyValues(options.resource);
  const transportFetch = options.transportFetch ?? fetch;
  let queue: OtlpLogRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = (logRecords: OtlpLogRecord[]): Promise<void> =>
    transportFetch(options.logsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...options.headers },
      body: JSON.stringify(
        buildLogsPayload(resourceAttributes, options.scope, logRecords),
      ),
      // Telemetry must never break the page: delivery is best-effort.
    }).then(
      () => undefined,
      () => undefined,
    );

  const flush = (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (queue.length === 0) return Promise.resolve();
    const logRecords = queue;
    queue = [];
    return send(logRecords);
  };

  return {
    emit(eventName, attributes = {}) {
      if (queue.length >= MAX_QUEUE_SIZE) return;
      queue.push({
        timeUnixNano: `${Date.now()}000000`,
        severityNumber: SEVERITY_INFO,
        eventName,
        attributes: toKeyValues({ ...options.envelope(), ...attributes }),
      });
      if (queue.length >= MAX_BATCH_SIZE) {
        void flush();
      } else if (timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined;
          void flush();
        }, SCHEDULED_DELAY_MS);
      }
    },
    flush,
    shutdown: flush,
  };
}
