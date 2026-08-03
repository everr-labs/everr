// The SDK's own emit pipeline: an in-memory queue, a batch timer, and one
// fetch POST of OTLP JSON per flush. Owning the queue (instead of OTel's
// BatchLogRecordProcessor) is what lets the exit flush truncate to the
// keepalive budget. Wire shapes follow the OTLP JSON mapping (intValue is
// a decimal string); everything else internal is positional, since property
// names survive minification and tuple indexes do not.

export type AttrValue = string | number | boolean;

// The full event taxonomy in one typed home: the semconv-registered names
// stay bare, everything else carries the everr prefix. Type-only (zero
// runtime bytes), so a missed prefix or stale name is a compile error.
export type EventName =
  | "browser.web_vital"
  | "exception"
  | "everr.browser.page_view"
  | "everr.browser.page_leave"
  | "everr.browser.slow_interaction"
  | "everr.browser.interaction.rage_click"
  | "everr.browser.interaction.click"
  | "everr.browser.interaction.change"
  | "everr.browser.interaction.submit";

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
  body: AnyValue;
  attributes: KeyValue[];
};

/**
 * `severityNumber` defaults to INFO (9) and `body` to the event name; the
 * error signal overrides both. `""` emits a plain log record (no event
 * name): the custom logger's shape, where callers always pass a body.
 */
export type Emit = (
  eventName: EventName | "",
  attributes?: Record<string, AttrValue | null | undefined>,
  severityNumber?: number,
  body?: string,
) => void;

type Emitter = [
  emit: Emit,
  flush: () => Promise<void>,
  /**
   * Exit-path flush: fetch keepalive, with the payload truncated to the
   * keepalive budget (newest records dropped first).
   */
  exitFlush: () => void,
];

// Same tuning as the web app's browser telemetry client. The queue itself is
// deliberately unbounded: no record is dropped before sampling exists, and
// the batch-size flush keeps it small in practice.
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
  attributes: Record<string, AttrValue | null | undefined>,
): KeyValue[] {
  // Skipping nullish lets callers write optional attributes as plain
  // properties (and pass DOM getters that return null) with no ceremony.
  return Object.entries(attributes).flatMap(([key, value]) =>
    value == null ? [] : [{ key, value: toAnyValue(value) }],
  );
}

export function createEmitter(
  logsUrl: string,
  extraHeaders: Record<string, string> | undefined,
  resourceAttributes: Record<string, AttrValue | null | undefined>,
  scope: { name: string; version: string },
  /** Called per record; returns the context envelope to stamp. */
  envelope: () => Record<string, AttrValue | null | undefined>,
): Emitter {
  const resource = toKeyValues(resourceAttributes);
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  let queue: OtlpLogRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let exitScheduled = false;

  const build = () =>
    JSON.stringify({
      resourceLogs: [
        {
          resource: { attributes: resource },
          scopeLogs: [{ scope, logRecords: queue }],
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
      return fetch(logsUrl, { method: "POST", headers, body, keepalive }).then(
        noop,
        noop,
      );
    } catch {
      return noop();
    }
  };

  const flush = (keepalive?: boolean): Promise<void> => {
    const body = takeBody();
    return body ? post(body, keepalive) : noop();
  };

  const exitFlush = (): void => {
    // Truncate whole records, newest first, until the batch fits the
    // keepalive budget.
    while (queue.length > 1 && new Blob([build()]).size > EXIT_BUDGET)
      queue.pop();
    void flush(true);
  };

  const emit: Emit = (
    eventName,
    attributes,
    severityNumber = 9, // INFO
    // Body defaults to the event name so log browsers show a readable line.
    body = eventName,
  ) => {
    queue.push({
      timeUnixNano: `${Date.now()}000000`,
      severityNumber,
      eventName,
      body: toAnyValue(body),
      attributes: toKeyValues({ ...envelope(), ...attributes }),
    });
    // Records emitted while the page is hidden (web-vitals reports CLS and
    // INP from its own hidden-state listeners, in no guaranteed order
    // relative to the client's exit flush) must not strand in a queue whose
    // timer will never fire: a microtask-coalesced exit flush ships them on
    // the keepalive path regardless of listener ordering. The document guard
    // is the server path (SSR has no document, and no exit either).
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      if (!exitScheduled) {
        exitScheduled = true;
        queueMicrotask(() => {
          exitScheduled = false;
          exitFlush();
        });
      }
    } else if (queue.length >= MAX_BATCH_SIZE) {
      void flush();
    } else if (timer === undefined) {
      timer = setTimeout(() => void flush(), SCHEDULED_DELAY_MS);
      // On the server a pending batch must not hold the process open past
      // its last request; browsers return a number and skip this.
      (timer as unknown as { unref?: () => void }).unref?.();
    }
  };

  return [emit, flush, exitFlush];
}
