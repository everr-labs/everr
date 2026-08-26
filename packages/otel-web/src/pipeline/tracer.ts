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
// each span of the SDK. There is no context manager. Thus startActiveSpan calls
// its function but does not make the span active. A span is its own trace,
// except when the caller gives the context from childOf(parent) as the third
// argument of startSpan: the new span then joins the trace of the parent as
// its child. The tracer accepts the events and the links, but it discards
// them, because the payload carries neither of them.

import type {
  Context,
  Exception,
  Span,
  SpanOptions,
  Tracer,
} from "@opentelemetry/api";
import { randomHex } from "../state/session.js";
import type { AttrValue, EmitSpan } from "./emitter.js";

// Changes an OTel TimeInput to milliseconds from the epoch. For an hrtime value
// and a Date value, the code uses the current time.
const toMs = (time: unknown): number | undefined =>
  typeof time === "number" ? time : undefined;

// The key of the parent span in a context from childOf(). The @opentelemetry/api
// context keys are not available at run time, and thus the tracer has its own
// key. The context is empty for each other key.
const PARENT = Symbol();
type ParentContext = Context & { [PARENT]?: Span };

/**
 * A context that makes `parent` the parent of the next span. Use it as the
 * third argument of `tracer.startSpan(name, options, childOf(parent))`.
 */
export function childOf(parent: Span): Context {
  const context: ParentContext = {
    [PARENT]: parent,
    getValue: () => undefined,
    setValue: () => context,
    deleteValue: () => context,
  };
  return context;
}

export function createTracer(emitSpan: EmitSpan): Tracer {
  const startSpan = (
    name: string,
    options?: SpanOptions,
    context?: Context,
  ): Span => {
    // One read of the CSPRNG gives the two ids, the same as in the network
    // signal. A child keeps the trace id of its parent.
    const parent = (context as ParentContext | undefined)?.[
      PARENT
    ]?.spanContext();
    const ids = randomHex(24);
    const spanContext = {
      traceId: parent?.traceId ?? ids.slice(0, 32),
      spanId: ids.slice(32),
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
      // value.
      setAttribute: (key, value) => {
        attributes[key] = value as AttrValue;
        return span;
      },
      setAttributes: (attrs) => {
        Object.assign(attributes, attrs);
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
    startSpan,
    // This function accepts all the argument sequences. The function to call is
    // always the last argument. The options are the first argument and the
    // context is the second argument when they come before the function. The
    // code does not make the span active.
    startActiveSpan: ((name: string, ...rest: unknown[]) => {
      const fn = rest[rest.length - 1] as (span: Span) => unknown;
      const options =
        rest.length > 1 ? (rest[0] as SpanOptions | undefined) : undefined;
      const context =
        rest.length > 2 ? (rest[1] as Context | undefined) : undefined;
      return fn(startSpan(name, options, context));
    }) as Tracer["startActiveSpan"],
  };
}
