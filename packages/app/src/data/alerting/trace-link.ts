import { trace } from "@opentelemetry/api";
import { z } from "zod";

/**
 * A queue hop carries the enqueuer's span context so the consumer can link
 * back to it. It is optional everywhere: the set-based SQL that releases a
 * silence has no span to send, and a job that cannot say what caused it is
 * still worth running.
 *
 * This lives beside the payload schemas rather than in the engine's telemetry
 * module, because the enqueue helpers are reachable from client code, which
 * must not pull in a meter or a tracer.
 *
 * `nullish`, not `optional`: the set-based enqueue builds its JSON with
 * `json_build_object`, which writes an explicit null rather than omitting the
 * key.
 */
export const TraceLinkSchema = z.object({
  traceparent: z.string().nullish(),
});

export type TraceLink = z.infer<typeof TraceLinkSchema>;

/** Serializes the active span into W3C traceparent form for a job payload. */
export function currentTraceLink(): TraceLink {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return {};
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  return {
    traceparent: `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`,
  };
}
