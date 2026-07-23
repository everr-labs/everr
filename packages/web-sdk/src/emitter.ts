import {
  type AttrValue,
  buildLogsPayload,
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

// Same tuning as the web app's browser telemetry client.
const MAX_QUEUE_SIZE = 100;
const MAX_BATCH_SIZE = 32;
const SCHEDULED_DELAY_MS = 5_000;

const swallow = () => {};

export function createEmitter(options: {
  logsUrl: string;
  headers: Record<string, string> | undefined;
  resource: Record<string, AttrValue | undefined>;
  scope: { name: string; version: string };
  /** Called per record; returns the context envelope to stamp. */
  envelope: () => Record<string, AttrValue | undefined>;
  /** Test seam; defaults to the global fetch. */
  transportFetch?: typeof fetch;
}): Emitter {
  const resource = toKeyValues(options.resource);
  const transportFetch = options.transportFetch ?? fetch;
  let queue: OtlpLogRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    if (!queue.length) return Promise.resolve();
    const body = JSON.stringify(
      buildLogsPayload(resource, options.scope, queue),
    );
    queue = [];
    // Telemetry must never break the page: delivery is best-effort.
    return transportFetch(options.logsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...options.headers },
      body,
    }).then(swallow, swallow);
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
    shutdown: flush,
  };
}
