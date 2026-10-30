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
import type { SpanContext } from "@opentelemetry/api";
import type { Send, Signal } from "./transport.js";

export type AttrValue = string | number | boolean | string[] | number[] | boolean[];

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
  | "everr.browser.interaction.click"
  | "everr.browser.interaction.submit";

type AnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }
  | { arrayValue: { values: AnyValue[] } };

type KeyValue = { key: string; value: AnyValue };

type OtlpLogRecord = {
  timeUnixNano: string;
  severityNumber: number;
  eventName: string;
  body: AnyValue;
  attributes: KeyValue[];
  traceId?: string;
  spanId?: string;
  flags?: number;
};

type OtlpLink = {
  traceId: string;
  spanId: string;
  flags: number;
  attributes?: KeyValue[];
};

type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: KeyValue[];
  status?: { code: number; message?: string };
  links?: OtlpLink[];
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
  timestamp?: number,
  severityNumber?: number,
  body?: string,
) => void;

/** OTLP status. `UNSET` is omitted. The message is present only for `ERROR`. */
export type SpanStatus = { code: 1 } | { code: 2; message?: string };

/** One link to another span. `traceFlags` is the W3C trace-flags byte. */
export type SpanLink = SpanContext & {
  attributes?: Record<string, AttrValue | null | undefined>;
};

/**
 * Puts one completed span into the traces queue. The span carries the
 * envelope, the same as each log record. A span with a `parentSpanId` is a
 * child in the trace of `traceId`; without it, the span is the root of that
 * trace. The kind defaults to INTERNAL (OTLP 1).
 */
export type EmitSpan = (
  traceId: string,
  spanId: string,
  name: string,
  startTime: number,
  endTime: number,
  attributes: Record<string, AttrValue | null | undefined>,
  status?: SpanStatus,
  parentSpanId?: string,
  kind?: number,
  links?: SpanLink[],
) => void;

/**
 * One log record, immediately before the SDK puts it in the batch. A custom log
 * from `logger.*` has an eventName of `""`.
 */
export type LogEvent = {
  kind: "log";
  eventName: string;
  attributes: Record<string, AttrValue | null | undefined>;
  severityNumber: number;
  body: string;
};

/** One completed span, immediately before the SDK puts it in the batch. */
export type SpanEvent = {
  kind: "span";
  name: string;
  attributes: Record<string, AttrValue | null | undefined>;
  status?: SpanStatus;
  links?: SpanLink[];
};

/**
 * One item that the SDK is going to send. The `kind` field selects the type.
 *
 * The attributes are the full set that goes on the wire in the two conditions:
 * the envelope of the SDK (the session, the visitor, `url.full`, the route)
 * below the attributes of the signal. Thus one hook can apply a policy on an
 * attribute to all the signals.
 *
 * The ids and the times are absent, because a hook does not change the identity
 * of a record or the time of a record. Log correlation is written after the
 * hook, so the hook cannot see or change the trace id, span id, or trace flags.
 */
export type SendEvent = LogEvent | SpanEvent;

/**
 * Runs on each log record and on each span, immediately before the SDK puts the
 * item in its queue. It discards the item if it returns null. If not, it can
 * change the item.
 *
 * The SDK removes no data on its own. It sends the full URL in `url.full`, the
 * text of an element, and the message of an error without a change. This hook
 * is the one place to apply the policy of the application, and the application
 * is responsible for it.
 *
 * If the hook throws an error, the SDK discards the item and continues. This is
 * the same behavior that the other browser SDKs have. A hook operates in a
 * click listener or a fetch listener of the page, and thus an error from the
 * hook must not go to the page. The SDK gives one warning on the console for
 * each instance, and not one warning for each item.
 */
export type BeforeSend = (item: SendEvent) => SendEvent | null;

/**
 * Makes the function that applies the hook of the host. The browser entry and
 * the server entry use it, and thus the rule on an error and the rule on a
 * discard have one place.
 *
 * It gives null when the SDK must discard the item. An error from the hook also
 * discards the item: the hook exists to remove data, and thus an item that did
 * not go through it must not go on the wire. The warning operates one time for
 * each guard, because a hook that throws an error for each item would fill the
 * console.
 */
export function createBeforeSendGuard(
  beforeSend: BeforeSend | undefined,
): (item: SendEvent) => SendEvent | null {
  let warned = false;
  return (item) => {
    if (!beforeSend) return item;
    try {
      return beforeSend(item);
    } catch {
      if (!warned) {
        warned = true;
        console.warn("[everr] beforeSend threw; the SDK discards these items");
      }
      return null;
    }
  };
}

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
  emitNow: EmitNow,
];

/**
 * Sends one log record in its own logs request, outside the batch, without
 * keepalive and without the active span. The recording Segments use it: one
 * Segment is close to the size of a full request. The promise settles when the
 * request ends, and it never rejects.
 */
export type EmitNow = (
  eventName: string,
  attributes: Record<string, AttrValue | null | undefined>,
  timestamp: number,
  body: string,
) => Promise<void>;

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

function unixNano(ms: number): string {
  return `${Math.round(ms)}000000`;
}

function toAnyValue(value: AttrValue): AnyValue {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (!Array.isArray(value)) {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  return {
    arrayValue: {
      values: value.flatMap((entry) => (entry == null ? [] : [toAnyValue(entry)])),
    },
  };
}

function toKeyValues(attributes: Record<string, AttrValue | null | undefined>): KeyValue[] {
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
  envelope: (session?: string) => Record<string, AttrValue | null | undefined>,
  /** The hook of the host on each item. Refer to {@link BeforeSend}. */
  beforeSend?: BeforeSend,
  /** The span active at the time of the log, when there is one. */
  activeSpan?: (time?: number) => SpanContext | undefined,
): Emitter {
  const resource = toKeyValues(resourceAttributes);
  let queue: OtlpLogRecord[] = [];
  let spanQueue: OtlpSpan[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let exitScheduled = false;
  const applyBeforeSend = createBeforeSendGuard(beforeSend);
  const withEnvelope = (attributes: Record<string, AttrValue | null | undefined> = {}) => {
    const session = attributes["session.id"];
    return { ...envelope(typeof session === "string" ? session : undefined), ...attributes };
  };

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

  // The bytes of the items that the last firstFitting call kept, with their
  // envelope. The exit path reads it for the budget that the spans left to the
  // log records. Thus the code does not make that payload again only to
  // measure it. The count gives one comma for each item, and a list joins with
  // one comma less. Thus the value is never below the true size.
  let fittedBytes = 0;

  // The index of the first item that goes in `budget`, with the most recent
  // items kept. Each item adds its own bytes and its comma. The function
  // measures each item one time. The loop before it made the full payload again
  // for each item that it discarded, on the exit path, where the page closes.
  //
  // The result is the length of the list when even the most recent item is
  // above the budget. The signal then sends nothing, and this is correct: such
  // a payload is above the keepalive limit, fetch refuses it, and thus the
  // batch is lost without a record of the loss.
  const firstFitting = (items: unknown[], envelopeBytes: number, budget: number): number => {
    let used = envelopeBytes;
    let i = items.length;
    while (i > 0) {
      const next = used + bytes(JSON.stringify(items[i - 1])) + 1;
      if (next > budget) break;
      used = next;
      i--;
    }
    fittedBytes = i === items.length ? 0 : used;
    return i;
  };

  // The telemetry must never cause a failure of the page. Thus the code tries
  // to send the data, but it accepts a failure. This includes a synchronous
  // error. This is true for a `send` function from the caller and for fetch.
  //
  // The keepalive option continues after the page closes. There is no
  // alternative that uses sendBeacon, and this is correct: sendBeacon cannot
  // carry the Authorization header, and thus it cannot send data to the hosted
  // ingest.
  const post = (signal: Signal, body: string, keepalive?: boolean): Promise<void> => {
    try {
      return Promise.resolve(send(signal, body, keepalive)).then(noop, noop);
    } catch {
      return noop();
    }
  };

  const sortBy = <T, K extends keyof T>(items: T[], key: K) =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- Timestamp wire fields are strings; preserve their direct BigInt conversion.
    items.sort((a, b) => Number(BigInt(a[key] as string) - BigInt(b[key] as string)));

  const flush = (keepalive?: boolean): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    // Array.sort is stable, so records with the same timestamp keep their
    // capture order. The exit path truncates before this sort, preserving its
    // rule that records emitted by hide handlers stay in the constrained batch.
    sortBy(queue, "timeUnixNano");
    sortBy(spanQueue, "startTimeUnixNano");
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
    // Remove full records, the oldest record first, until the two keepalive
    // payloads together are less than the limit. The spans get a maximum of one
    // quarter of the limit, and the log records get the remainder.
    //
    // The sequence is from the front, because the records of the exit are the
    // most recent records in the queue. The hide handler of an instrumentation
    // operates before this function: those listeners registered first, and thus
    // the page_leave record and the vitals of the exit go into the queue
    // immediately before this truncation. A sequence from the back removes
    // them first, which is the opposite of the intention. A record that is
    // older had the full delay of the batch to go out on a usual flush.
    //
    // The code does not do this when the host sends the data. The limit is a
    // constraint of fetch only. Thus the code discards no record.
    if (truncateAtExit) {
      spanQueue = spanQueue.slice(
        firstFitting(spanQueue, bytes(build("Spans", "spans", [])), EXIT_BUDGET / 4),
      );
      const spanBytes = fittedBytes;
      queue = queue.slice(
        firstFitting(queue, bytes(build("Logs", "logRecords", [])), EXIT_BUDGET - spanBytes),
      );
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
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
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
      // oxlint-disable-next-line typescript/consistent-type-assertions -- Preserve optional unref dispatch on the original timer handle without restricting its runtime type.
      (timer as unknown as { unref?: () => void }).unref?.();
    }
  };

  const logRecord = (
    eventName: string,
    attributes: Record<string, AttrValue | null | undefined> | undefined,
    timestamp: string,
    severityNumber: number,
    body: string,
    span: SpanContext | undefined,
  ): OtlpLogRecord | undefined => {
    const item = applyBeforeSend({
      kind: "log",
      eventName,
      attributes: withEnvelope(attributes),
      severityNumber,
      body,
    });
    // The type of the hook permits a return of the other kind. Thus this test
    // is the narrowing that the union needs, and it is not a check on the type
    // at run time.
    if (item?.kind !== "log") return;
    return {
      timeUnixNano: timestamp,
      severityNumber: item.severityNumber,
      eventName: item.eventName,
      body: toAnyValue(item.body),
      attributes: toKeyValues(item.attributes),
      ...(span ? { traceId: span.traceId, spanId: span.spanId, flags: span.traceFlags } : {}),
    };
  };

  const emit: Emit = (
    eventName,
    attributes,
    time,
    severityNumber = 9, // INFO
    body = eventName,
  ) => {
    // Read the time before the hook. The default is the instant emit was
    // called, even when a host hook does synchronous work before the item is
    // queued. A log with an earlier timestamp takes the span that was already
    // active at that time, and not a span that became active after it.
    const timestamp = unixNano(time ?? Date.now());
    const record = logRecord(
      eventName,
      attributes,
      timestamp,
      severityNumber,
      body,
      activeSpan?.(time),
    );
    if (!record) return;
    queue.push(record);
    schedule();
  };

  const emitNow: EmitNow = (eventName, attributes, time, body) => {
    const record = logRecord(eventName, attributes, unixNano(time), 9, body, undefined);
    return record ? post("logs", build("Logs", "logRecords", [record])) : noop();
  };

  const emitSpan: EmitSpan = (
    traceId,
    spanId,
    name,
    startTime,
    endTime,
    attributes,
    status,
    parentSpanId,
    kind = 1, // INTERNAL. Callers pass CLIENT for a request span.
    links,
  ) => {
    // The hook sees the envelope also, and not only the attributes of the
    // instrumentation. The envelope carries `url.full`. Thus a host that
    // removes a query parameter has one place to do it, for the log records,
    // for the spans of the network instrumentation, and for the spans of its
    // own instrumentations.
    const item = applyBeforeSend({
      kind: "span",
      name,
      attributes: withEnvelope(attributes),
      status,
      links,
    });
    if (item?.kind !== "span") return;
    const wireLinks = item.links?.map((link) => {
      const attributes = toKeyValues(link.attributes ?? {});
      return {
        traceId: link.traceId,
        spanId: link.spanId,
        flags: link.traceFlags,
        ...(attributes.length ? { attributes } : {}),
      };
    });
    spanQueue.push({
      traceId,
      spanId,
      parentSpanId,
      name: item.name,
      kind,
      startTimeUnixNano: unixNano(startTime),
      endTimeUnixNano: unixNano(endTime),
      attributes: toKeyValues(item.attributes),
      // UNSET is absent. JSON also removes a value of undefined.
      status: item.status,
      ...(wireLinks?.length ? { links: wireLinks } : {}),
    });
    schedule();
  };

  return [emit, flush, exitFlush, emitSpan, emitNow];
}
