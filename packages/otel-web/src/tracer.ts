// The SDK's OTel Tracer, handed to plugins: a minimal implementation of the
// @opentelemetry/api Tracer interface over the SDK's own span pipeline, so a
// plugin span gets exactly the network signal's treatment: enveloped,
// batched, and shipped on the traces pipeline. @opentelemetry/api is a
// type-only import here: no runtime dependency and no registered global
// provider is involved.
//
// Scope of the implementation: every span is its own always-sampled trace
// (ids minted locally, exposed via spanContext() so a plugin can propagate
// them), kind is CLIENT like every SDK span, and there is no context
// manager, so startActiveSpan runs its callback without activating the span
// and spans never parent each other. Events and links are accepted and
// dropped (the wire shape carries neither).

import type { Exception, Span, SpanOptions, Tracer } from "@opentelemetry/api";
import type { AttrValue, EmitSpan } from "./emitter.js";
import { randomHex } from "./session.js";

// OTel TimeInput narrowed to epoch millis; hrtime and Date fall back to now.
const toMs = (time: unknown): number | undefined =>
  typeof time === "number" ? time : undefined;

export function createTracer(emitSpan: EmitSpan): Tracer {
  const startSpan = (name: string, options?: SpanOptions): Span => {
    // One CSPRNG draw covers both ids, same as the network signal.
    const ids = randomHex(24);
    const spanContext = {
      traceId: ids.slice(0, 32),
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
      // Attributes land verbatim: the emitter's AttrValue types are the
      // contract, array values are the caller's problem.
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
        // Semconv's exception event, flattened to span attributes since the
        // wire shape carries no events.
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
        );
      },
    };
    if (options?.attributes) span.setAttributes(options.attributes);
    return span;
  };

  return {
    startSpan,
    // Overload-collapsed: the callback is always the last argument, options
    // the first when more than one precedes it. No context activation.
    startActiveSpan: ((name: string, ...rest: unknown[]) => {
      const fn = rest[rest.length - 1] as (span: Span) => unknown;
      const options =
        rest.length > 1 ? (rest[0] as SpanOptions | undefined) : undefined;
      return fn(startSpan(name, options));
    }) as Tracer["startActiveSpan"],
  };
}
