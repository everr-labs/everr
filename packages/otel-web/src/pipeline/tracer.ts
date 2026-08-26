// The OTel Tracer of the SDK. The SDK gives it to the instrumentations. It is a
// small implementation of the Tracer interface of @opentelemetry/api on the
// span pipeline of the SDK. Thus a span from an instrumentation gets the same
// operations as a span from the network signal: the SDK adds the envelope, it
// puts the span in a batch, and it sends the span on the traces pipeline. This
// module imports @opentelemetry/api for the types only. Thus there is no
// dependency at run time, and the code uses no global provider.
//
// The implementation has these limits. The SDK always samples a span. The code
// makes the ids locally and gives them with spanContext(), and thus an
// instrumentation can send them to a server. The kind is CLIENT, the same as
// each span of the SDK. The tracer accepts the events and the links, but it
// discards them, because the payload carries neither of them.
//
// There is no context manager, and the active span has a rule of its own. In
// OTel, a span is active for the synchronous duration of the function of
// startActiveSpan, and a context manager carries it into the callbacks. This
// SDK has no such manager: a span from startActiveSpan is active from that
// call until its end(). A span from startSpan is a child of the active span,
// when there is one, or a root. Thus the rule is the time, and not the cause:
// each span that starts while the page load root is active joins its trace.
// The active spans are a stack, and the most recent is the parent of a new
// span. The end() of a span removes it from the stack, in any sequence. The
// tracer ignores the context argument of the two functions.

import type { Exception, Span, SpanOptions, Tracer } from "@opentelemetry/api";
import { randomHex } from "../state/session.js";
import type { AttrValue, EmitSpan } from "./emitter.js";

// Changes an OTel TimeInput to milliseconds from the epoch. For an hrtime value
// and a Date value, the code uses the current time.
const toMs = (time: unknown): number | undefined =>
  typeof time === "number" ? time : undefined;

export function createTracer(emitSpan: EmitSpan): Tracer {
  // The active spans, the most recent last.
  const active: Span[] = [];

  // Makes a span. The most recent active span, when there is one, is the
  // parent.
  const make = (name: string, options?: SpanOptions): Span => {
    // One read of the CSPRNG gives the ids, the same as in the network
    // signal. A child keeps the trace id of its parent, and thus it reads only
    // the bytes of its span id.
    const parent = active[active.length - 1]?.spanContext();
    const ids = randomHex(parent ? 8 : 24);
    const spanContext = {
      traceId: parent?.traceId ?? ids.slice(0, 32),
      spanId: ids.slice(-16),
      traceFlags: 1, // always sampled
    };
    const attributes: Record<string, AttrValue> = {};
    const start = toMs(options?.startTime) ?? Date.now();
    let spanName = name;
    let ended = false;
    let errored = false;

    const span: Span = {
      spanContext: () => spanContext,
      // The code copies the attributes without a change. The AttrValue types of
      // the emitter give the rules. The caller is responsible for an array
      // value. An ended span accepts no attribute, the same as in OTel.
      setAttribute: (key, value) => {
        if (!ended) attributes[key] = value as AttrValue;
        return span;
      },
      setAttributes: (attrs) => {
        if (!ended) Object.assign(attributes, attrs);
        return span;
      },
      addEvent: () => span,
      addLink: () => span,
      addLinks: () => span,
      setStatus: (status) => {
        errored = status.code === 2; // SpanStatusCode.ERROR
        return span;
      },
      updateName: (next) => {
        spanName = next;
        return span;
      },
      isRecording: () => !ended,
      recordException: (exception: Exception) => {
        const error = exception as { name?: string; message?: string };
        // The exception event of semconv. The code puts it in the span
        // attributes, because the payload carries no events.
        span.setAttribute(
          "exception.type",
          (typeof exception === "object" && error.name) || "Error",
        );
        if (typeof exception === "string") {
          span.setAttribute("exception.message", exception);
        } else if (error.message) {
          span.setAttribute("exception.message", error.message);
        }
      },
      end: (endTime) => {
        if (ended) return;
        ended = true;
        const index = active.indexOf(span);
        if (index >= 0) active.splice(index, 1);
        emitSpan(
          spanContext.traceId,
          spanContext.spanId,
          spanName,
          start,
          toMs(endTime) ?? Date.now(),
          attributes,
          errored,
          parent?.spanId,
        );
      },
    };
    if (options?.attributes) span.setAttributes(options.attributes);
    return span;
  };

  return {
    startSpan: (name, options) => make(name, options),
    // This function accepts all the argument sequences. The function to call is
    // always the last argument, and the options are the first argument when
    // there is one before it. The span is active from this call until its
    // end().
    startActiveSpan: ((name: string, ...rest: unknown[]) => {
      const fn = rest.pop() as (span: Span) => unknown;
      const span = make(name, rest[0] as SpanOptions | undefined);
      active.push(span);
      return fn(span);
    }) as Tracer["startActiveSpan"],
  };
}
