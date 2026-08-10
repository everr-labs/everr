// The emit pipeline of the SDK. It contains a queue in memory and a batch
// timer. For each flush it makes one OTLP JSON payload for each signal, then
// it gives the payload to the `send` function of the transport. The default
// `send` function does a fetch POST.
//
// This pipeline holds its own queue and does not use the OTel
// BatchLogRecordProcessor. Thus the flush at exit can decrease the payload to
// the keepalive limit. The payloads agree with the OTLP JSON mapping, and thus
// an intValue is a decimal string. The other internal structures use tuples,
// because minification keeps the property names but it does not keep the tuple
// indexes.
import type { Send, Signal } from "./config.js";

export type AttrValue = string | number | boolean;

// All the event names in one type. The names that semconv registers have no
// prefix. All the other names have the everr prefix. This is a type only, and
// thus it adds no bytes to the build. A name without its prefix, or a name that
// is not current, is a compile error in the built-in instrumentations. The
// (string & {}) part lets an instrumentation name through without a cast, and
// an editor can still complete the names in the union.
export type EventName =
  | "browser.web_vital"
  | "exception"
  | "everr.browser.page_view"
  | "everr.browser.page_leave"
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
 * The default `severityNumber` is INFO (9), and the default `body` is the
 * event name. The error signal replaces the two values. An event name of `""`
 * makes a log record with no event name. The custom logger uses this
 * structure, because its callers always send a body.
 */
export type Emit = (
  // The (string & {}) part lets an instrumentation event name through without
  // a cast, and an editor can still complete the EventName union.
  eventName: EventName | "" | (string & {}),
  attributes?: Record<string, AttrValue | null | undefined>,
  severityNumber?: number,
  body?: string,
) => void;

/**
 * Puts one completed CLIENT span into the traces queue. The span carries the
 * envelope, the same as each log record. The `error` value becomes the OTLP
 * status ERROR.
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
   * The flush on the exit path. It uses fetch with keepalive. It decreases the
   * payload to the keepalive limit, and it discards the most recent records
   * first.
   */
  exitFlush: () => void,
  emitSpan: EmitSpan,
];

// These values are the same as the values in the browser telemetry client of
// the web app. The queue has no limit, and this is correct. The SDK discards no
// record before the sampling. Also, the flush at the batch size keeps the queue
// small.
const MAX_BATCH_SIZE = 32;
const SCHEDULED_DELAY_MS = 5_000;

// The keepalive limit for the data in transmission, in bytes. The code counts
// the bytes, because an attribute value with multibyte characters has more
// bytes than the length of the string.
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
  // The code ignores a value of null and a value of undefined. Thus a caller
  // can write an optional attribute as a usual property, and it can send a DOM
  // getter that returns null.
  return Object.entries(attributes).flatMap(([key, value]) =>
    value == null ? [] : [{ key, value: toAnyValue(value) }],
  );
}

export function createEmitter(
  /** Sends one OTLP/JSON payload for each signal. Refer to config.ts. */
  send: Send,
  /**
   * True if the batch at exit must be less than the fetch keepalive limit. It
   * is false when the host sends the data, because then there is no such limit.
   */
  truncateAtExit: boolean,
  resourceAttributes: Record<string, AttrValue | null | undefined>,
  scope: { name: string; version: string },
  /** The code calls this for each record. It returns the context envelope. */
  envelope: () => Record<string, AttrValue | null | undefined>,
): Emitter {
  const resource = toKeyValues(resourceAttributes);
  let queue: OtlpLogRecord[] = [];
  let spanQueue: OtlpSpan[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let exitScheduled = false;

  // One function makes the OTLP envelope for the two signals. The three keys
  // are different only in their names: resourceLogs, scopeLogs, and logRecords
  // for the logs, and resourceSpans and the equivalent names for the spans.
  const build = (kind: string, listKey: string, items: unknown[]) =>
    JSON.stringify({
      [`resource${kind}`]: [
        {
          resource: { attributes: resource },
          [`scope${kind}`]: [{ scope, [listKey]: items }],
        },
      ],
    });
  const buildLogs = () => build("Logs", "logRecords", queue);
  const buildSpans = () => build("Spans", "spans", spanQueue);
  const bytes = (body: string) => new Blob([body]).size;

  // The telemetry must never cause a failure of the page. Thus the code tries
  // to send the data, but it accepts a failure. This includes a synchronous
  // error. This is true for a `send` function from the caller and for fetch.
  //
  // The keepalive option continues after the page closes. There is no
  // alternative that uses sendBeacon, and this is correct: sendBeacon cannot
  // carry the Authorization header, and thus it cannot send data to the hosted
  // ingest.
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
    // Remove full records, the most recent record first, until the two
    // keepalive payloads together are less than the limit. The spans get a
    // maximum of one quarter of the limit, and the log records get the
    // remainder. This sequence is correct, because the page_leave record and
    // the vitals in the queue are more important than the fetch operations in
    // transmission.
    //
    // The code does not do this when the host sends the data. The limit is a
    // constraint of fetch only. Thus the code discards no record.
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

  // The common batch code for the two queues. The SDK can send a record while
  // the page is hidden. For example, web-vitals reports CLS and INP from its
  // own listeners for the hidden state, and the sequence of those listeners
  // and the exit flush of the client is not known. Such a record must not stay
  // in a queue whose timer never operates. Thus the exit flush collects the
  // records in one microtask and sends them on the keepalive path, for each
  // sequence of the listeners. The test of the document is for the server
  // path, because SSR has no document and no exit.
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
      // On the server, a batch that waits must not keep the process open after
      // its last request. A browser returns a number and does not do this.
      (timer as unknown as { unref?: () => void }).unref?.();
    }
  };

  const emit: Emit = (
    eventName,
    attributes,
    severityNumber = 9, // INFO
    // The default body is the event name. Thus a log viewer shows a line that
    // the user can read.
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
      // This is STATUS_CODE_ERROR. If not, the field is absent and thus Unset,
      // because JSON removes a value of undefined.
      status: error ? { code: 2 } : undefined,
    });
    schedule();
  };

  return [emit, flush, exitFlush, emitSpan];
}
