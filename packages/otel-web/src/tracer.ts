import type { Span, SpanOptions, Tracer } from "@opentelemetry/api";
import { createTracer } from "./pipeline/tracer.js";

let current: Tracer | undefined;

/** Capture custom segments through the current WebSDK. In the browser, an
 * active span stays active until end(), including across awaited work. */
export const tracer: Tracer = {
  startSpan: (name, options, context) =>
    (current ?? createTracer()).startSpan(
      name,
      { ...options, kind: options?.kind ?? 0 },
      context,
    ),
  startActiveSpan: ((name: string, ...rest: unknown[]) => {
    const fn = rest.pop() as (span: Span) => unknown;
    const options = rest[0] as SpanOptions | undefined;
    return (current ?? createTracer()).startActiveSpan(
      name,
      { ...options, kind: options?.kind ?? 0 },
      fn,
    );
  }) as Tracer["startActiveSpan"],
};

export function bindTracer(next: Tracer): () => void {
  current = next;
  return () => {
    if (current === next) current = undefined;
  };
}
