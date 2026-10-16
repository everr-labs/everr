// The OTel Tracer of the SDK. The SDK gives it to the instrumentations. It is a
// small implementation of the Tracer interface of @opentelemetry/api on the
// span pipeline of the SDK. Thus a span from an instrumentation gets the same
// operations as a span from the network signal: the SDK adds the envelope, it
// puts the span in a batch, and it sends the span on the traces pipeline. This
// module imports @opentelemetry/api for the types only. Thus there is no
// dependency at run time, and the code uses no global provider.
//
// The SDK always samples a span. The code makes the ids locally and gives them
// with spanContext(), and thus an instrumentation can send them to a server.
// The kind is INTERNAL unless options.kind overrides it. A request span passes
// CLIENT itself. addEvent and recordException record nothing. Links, status,
// attribute arrays, and the accepted timestamp forms go on the span.
//
// There is no context manager, and the active span has a rule of its own. In
// OTel, a span is active for the synchronous duration of the function of
// startActiveSpan, and a context manager carries it into the callbacks. This
// SDK has no such manager: a span from startActiveSpan is active from that
// call until its end(). A span from startSpan is a child of the active span,
// when there is one, or a root. The active spans are a stack, and the most
// recent is the parent of a new span. The end() of a span removes it from the
// stack, in any sequence. The tracer ignores the context argument of the two
// functions. options.root starts a new trace, and a startActiveSpan with that
// option still becomes the active parent until its end(). A log emitted in
// that interval, with no timestamp of its own, carries that span's trace id,
// span id, and trace flags.

import type {
  Link,
  Span,
  SpanContext,
  SpanOptions,
  Tracer,
} from "@opentelemetry/api";
import { randomHex } from "../state/session.js";
import type { AttrValue, EmitSpan, SpanLink, SpanStatus } from "./emitter.js";

const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);

function epochMs(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : Date.now();
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : Date.now();
  }
  // Round the nanoseconds on their own. Adding them to the seconds as a
  // fraction makes a non-integer millisecond, and the encoder then writes an
  // invalid timestamp.
  if (
    Array.isArray(value) &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    return Math.trunc(value[0]) * 1000 + Math.round(Math.trunc(value[1]) / 1e6);
  }
  return Date.now();
}

function hexId(value: unknown, length: number, zero: string): value is string {
  return (
    typeof value === "string" &&
    value.length === length &&
    value !== zero &&
    /^[0-9a-f]+$/i.test(value)
  );
}

function cleanLink(link: Link): SpanLink | undefined {
  const context = link.context;
  if (!hexId(context?.traceId, 32, ZERO_TRACE)) return undefined;
  if (!hexId(context.spanId, 16, ZERO_SPAN)) return undefined;
  const flags = context.traceFlags;
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    traceFlags: typeof flags === "number" && Number.isFinite(flags) ? flags : 0,
    ...(link.attributes
      ? {
          attributes: link.attributes as Record<
            string,
            AttrValue | null | undefined
          >,
        }
      : {}),
  };
}

export function createTracer(emitSpan?: EmitSpan): Tracer & {
  activeSpanContext(): SpanContext | undefined;
} {
  // The active spans, the most recent last.
  const active: Span[] = [];

  // Makes a span. The most recent active span, when there is one, is the
  // parent. options.root starts a new trace.
  const make = (name: string, options?: SpanOptions): Span => {
    // One read of the CSPRNG gives the ids, the same as in the network
    // signal. A child keeps the trace id of its parent, and thus it reads only
    // the bytes of its span id.
    const parent = options?.root
      ? undefined
      : active[active.length - 1]?.spanContext();
    const ids = emitSpan ? randomHex(parent ? 8 : 24) : "0".repeat(48);
    const spanContext = {
      traceId: parent?.traceId ?? ids.slice(0, 32),
      spanId: ids.slice(-16),
      traceFlags: emitSpan ? 1 : 0,
    };
    const attributes: Record<string, AttrValue> = {};
    const links: SpanLink[] = [];
    const start =
      options?.startTime == null ? Date.now() : epochMs(options.startTime);
    let spanName = name;
    let ended = false;
    // UNSET until setStatus records OK or ERROR. OK sticks.
    let status: SpanStatus | undefined;

    const span: Span = {
      spanContext: () => spanContext,
      setAttribute: (key, value) => {
        if (!ended) attributes[key] = value as AttrValue;
        return span;
      },
      setAttributes: (attrs) => {
        if (!ended) Object.assign(attributes, attrs);
        return span;
      },
      addEvent: () => span,
      addLink: (link) => {
        if (ended) return span;
        const cleaned = cleanLink(link);
        if (cleaned) links.push(cleaned);
        return span;
      },
      addLinks: (next) => {
        for (const link of next) span.addLink(link);
        return span;
      },
      setStatus: (next) => {
        // UNSET is ignored. OK sticks, and a later status does not replace it.
        // The message is kept only for ERROR.
        if (ended || next.code === 0 || status?.code === 1) return span;
        if (next.code === 1) status = { code: 1 };
        else if (next.code === 2) {
          status = next.message
            ? { code: 2, message: next.message }
            : { code: 2 };
        }
        return span;
      },
      updateName: (next) => {
        if (!ended) spanName = next;
        return span;
      },
      isRecording: () => !!emitSpan && !ended,
      recordException: () => {},
      end: (endTime) => {
        if (ended) return;
        ended = true;
        const index = active.indexOf(span);
        if (index >= 0) active.splice(index, 1);
        emitSpan?.(
          spanContext.traceId,
          spanContext.spanId,
          spanName,
          start,
          endTime == null ? Date.now() : epochMs(endTime),
          attributes,
          status,
          parent?.spanId,
          (options?.kind ?? 0) + 1, // OTel API kinds are zero-based; OTLP is one-based.
          links.length ? links : undefined,
        );
      },
    };
    if (options?.attributes) span.setAttributes(options.attributes);
    if (options?.links) span.addLinks(options.links);
    return span;
  };

  return {
    activeSpanContext: () => active[active.length - 1]?.spanContext(),
    startSpan: (name, options) => make(name, options),
    // This function accepts all the argument sequences. The function to call is
    // always the last argument, and the options are the first argument when
    // there is one before it. The span is active from this call until its
    // end().
    startActiveSpan: ((name: string, ...rest: unknown[]) => {
      const fn = rest.pop() as (span: Span) => unknown;
      const span = make(name, rest[0] as SpanOptions | undefined);
      if (emitSpan) active.push(span);
      return fn(span);
    }) as Tracer["startActiveSpan"],
  };
}
