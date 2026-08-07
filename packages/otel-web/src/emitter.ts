// The SDK's own emit pipeline: an in-memory queue, a batch timer, and one
// OTLP JSON payload per signal per flush, handed to the transport's `send`
// (a fetch POST by default). Owning the queue (instead of OTel's
// BatchLogRecordProcessor) is what lets the exit flush truncate to the
// keepalive budget. Wire shapes follow the OTLP JSON mapping (intValue is
// a decimal string); everything else internal is positional, since property
// names survive minification and tuple indexes do not.
import type { Send, Signal } from "./config.js";

export type AttrValue = string | number | boolean;

// The full event taxonomy in one typed home: the semconv-registered names
// stay bare, everything else carries the everr prefix. Type-only (zero
// runtime bytes), so a missed prefix or stale name is a compile error in the
// built-ins; the (string & {}) arm lets plugin names through uncast while
// keeping the union in completions.
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

type OtlpSpan = {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: KeyValue[];
  status?: { code: number };
};

/**
 * `severityNumber` defaults to INFO (9) and `body` to the event name; the
 * error signal overrides both. `""` emits a plain log record (no event
 * name): the custom logger's shape, where callers always pass a body.
 */
export type Emit = (
  // (string & {}) lets plugin event names through uncast, keeping the
  // EventName union alive in completions.
  eventName: EventName | "" | (string & {}),
  attributes?: Record<string, AttrValue | null | undefined>,
  severityNumber?: number,
  body?: string,
) => void;

/**
 * Pushes one finished CLIENT span onto the traces queue, stamped with the
 * envelope like every log record. `error` maps to OTLP status ERROR.
 */
export type EmitSpan = (
  traceId: string,
  spanId: string,
  name: string,
  startEpochMs: number,
  endEpochMs: number,
  attributes: Record<string, AttrValue | null | undefined>,
  error?: boolean,
) => void;

type Emitter = [
  emit: Emit,
  flush: () => Promise<void>,
  /**
   * Exit-path flush: fetch keepalive, with the payload truncated to the
   * keepalive budget (newest records dropped first).
   */
  exitFlush: () => void,
  emitSpan: EmitSpan,
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
  /** Delivers one OTLP/JSON payload per signal; see config.ts. */
  send: Send,
  /**
   * Whether the exit batch must fit the fetch keepalive budget. False when
   * the host owns delivery and no such budget exists.
   */
  truncateAtExit: boolean,
  resourceAttributes: Record<string, AttrValue | null | undefined>,
  scope: { name: string; version: string },
  /** Called per record; returns the context envelope to stamp. */
  envelope: () => Record<string, AttrValue | null | undefined>,
): Emitter {
  const resource = toKeyValues(resourceAttributes);
  let queue: OtlpLogRecord[] = [];
  let spanQueue: OtlpSpan[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let exitScheduled = false;

  // One OTLP envelope builder for both signals; the key triples differ only
  // by noun (resourceLogs/scopeLogs/logRecords vs resourceSpans/...).
  const build = (kind: string, listKey: string, items: unknown[]) =>
    JSON.stringify({
      ["resource" + kind]: [
        {
          resource: { attributes: resource },
          ["scope" + kind]: [{ scope, [listKey]: items }],
        },
      ],
    });
  const buildLogs = () => build("Logs", "logRecords", queue);
  const buildSpans = () => build("Spans", "spans", spanQueue);
  const bytes = (body: string) => new Blob([body]).size;

  // Telemetry must never break the page: delivery is best-effort, sync
  // throws included, and that holds for a caller-supplied send as much as
  // for fetch. keepalive survives the page teardown; deliberately no
  // sendBeacon fallback (it cannot carry the Authorization header, so it
  // could never deliver to the hosted ingest anyway).
  const post = (
    signal: Signal,
    body: string,
    keepalive?: boolean,
  ): Promise<void> => {
    try {
      return Promise.resolve(send(signal, body, keepalive)).then(noop, noop);
    } catch {
      return noop();
    }
  };

  const flush = (keepalive?: boolean): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    const posts: Promise<void>[] = [];
    if (queue.length) {
      posts.push(post("logs", buildLogs(), keepalive));
      queue = [];
    }
    if (spanQueue.length) {
      posts.push(post("traces", buildSpans(), keepalive));
      spanQueue = [];
    }
    return posts.length === 1 ? posts[0] : Promise.all(posts).then(noop, noop);
  };

  const exitFlush = (): void => {
    // Truncate whole records, newest first, until both keepalive payloads
    // fit the budget together: spans get at most a quarter, log records the
    // remainder (page_leave and buffered vitals outrank in-flight fetches).
    // Skipped entirely when the host owns delivery: the budget is a fetch
    // constraint, and dropping records for it would lose data for nothing.
    if (truncateAtExit) {
      let spanBytes = 0;
      if (spanQueue.length) {
        spanBytes = bytes(buildSpans());
        while (spanQueue.length > 1 && spanBytes > EXIT_BUDGET / 4) {
          spanQueue.pop();
          spanBytes = bytes(buildSpans());
        }
      }
      while (queue.length > 1 && bytes(buildLogs()) > EXIT_BUDGET - spanBytes)
        queue.pop();
    }
    void flush(true);
  };

  // Shared batching tail for both queues. Records emitted while the page is
  // hidden (web-vitals reports CLS and INP from its own hidden-state
  // listeners, in no guaranteed order relative to the client's exit flush)
  // must not strand in a queue whose timer will never fire: a
  // microtask-coalesced exit flush ships them on the keepalive path
  // regardless of listener ordering. The document guard is the server path
  // (SSR has no document, and no exit either).
  const schedule = (): void => {
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
    } else if (queue.length + spanQueue.length >= MAX_BATCH_SIZE) {
      void flush();
    } else if (timer === undefined) {
      timer = setTimeout(() => void flush(), SCHEDULED_DELAY_MS);
      // On the server a pending batch must not hold the process open past
      // its last request; browsers return a number and skip this.
      (timer as unknown as { unref?: () => void }).unref?.();
    }
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
    schedule();
  };

  const emitSpan: EmitSpan = (
    traceId,
    spanId,
    name,
    startEpochMs,
    endEpochMs,
    attributes,
    error,
  ) => {
    spanQueue.push({
      traceId,
      spanId,
      name,
      kind: 3, // SPAN_KIND_CLIENT
      startTimeUnixNano: `${startEpochMs}000000`,
      endTimeUnixNano: `${endEpochMs}000000`,
      attributes: toKeyValues({ ...envelope(), ...attributes }),
      // STATUS_CODE_ERROR; omitted (Unset) otherwise, JSON drops undefined.
      status: error ? { code: 2 } : undefined,
    });
    schedule();
  };

  return [emit, flush, exitFlush, emitSpan];
}
