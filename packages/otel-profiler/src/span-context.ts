import { type LabelSet, time } from "@datadog/pprof";
import { type Attributes, type Context, type SpanContext, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";

export const TRACE_ID_LABEL = "trace_id";
export const SPAN_ID_LABEL = "span_id";
export const TIMESTAMP_LABEL = "timestamp_unix_micros";
export const HTTP_ROUTE_ATTRIBUTE = "http.route";
const ROOT_SPAN_NAME_ATTRIBUTE = "everr.root_span.name";

/** The root labels repeat for every sample of a request, so pprof shares one copy. */
export const LOW_CARDINALITY_LABELS = [HTTP_ROUTE_ATTRIBUTE, ROOT_SPAN_NAME_ATTRIBUTE];

// The subset of an SDK span this module reads; keeps sdk-trace-base out of the
// public types.
type RecordingSpan = {
  readonly name: string;
  readonly attributes: Attributes;
  spanContext(): SpanContext;
};

/**
 * The local root of a span tree. While the root is open, labels read its live
 * name and attributes, because instrumentations set `http.route` and rename the
 * span after it starts. Once it ends only the final values stay, so the span
 * itself can be collected.
 */
type LocalRoot = { span?: RecordingSpan; name: string; route?: string };

type SampleContext = { traceId: string; spanId: string; root?: LocalRoot };

// Keyed by the span object, so an entry lives exactly as long as its span.
const sampleContexts = new WeakMap<object, SampleContext>();

const NO_SPAN = {};

/**
 * Tells the wall profiler which span is active, so each sample can link to it.
 *
 * The profiler keeps its context in V8's continuation-preserved embedder data,
 * the same slot AsyncLocalStorage uses on Node 24, so a context entered with
 * `runWithContext` follows the callback's awaits and is gone once `with()`
 * returns. `time.setContext` would not do: inside another storage's `run()` it
 * leaks into the caller's continuation, so work after an awaited span is still
 * charged to it.
 */
export class ProfilingContextManager extends AsyncLocalStorageContextManager {
  override with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    if (!time.isStarted()) return super.with(context, fn, thisArg, ...args);
    return super.with(context, () =>
      time.runWithContext(sampleContext(context), () => fn.apply(thisArg, args)),
    );
  }
}

/**
 * Records each span's local root, so samples taken anywhere in a request carry
 * the request's `http.route` and root span name. Add it to the SDK's
 * `spanProcessors`; without it samples still link to their span.
 */
export class ProfilingSpanProcessor {
  // The SDK calls it as a span processor.
  // fallow-ignore-next-line unused-class-member
  onStart(span: RecordingSpan, parentContext: Context): void {
    const parent = trace.getSpan(parentContext);
    const isLocalRoot = !parent || parent.spanContext().isRemote === true;
    const root = isLocalRoot
      ? { span, name: span.name }
      : parent && sampleContexts.get(parent)?.root;
    const { traceId, spanId } = span.spanContext();
    sampleContexts.set(span, { traceId, spanId, root });
  }

  // The SDK calls it as a span processor.
  // fallow-ignore-next-line unused-class-member
  onEnd(span: RecordingSpan): void {
    const root = sampleContexts.get(span)?.root;
    if (root?.span !== span) return;
    root.name = span.name;
    root.route = routeOf(span);
    root.span = undefined;
  }

  // The SDK calls it as a span processor.
  // fallow-ignore-next-line unused-class-member
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  // The SDK calls it as a span processor.
  // fallow-ignore-next-line unused-class-member
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

function sampleContext(context: Context): SampleContext | typeof NO_SPAN {
  const span = trace.getSpan(context);
  if (!span) return NO_SPAN;
  const known = sampleContexts.get(span);
  if (known) return known;
  // A span the processor did not see: a remote parent, or no processor at all.
  const spanContext = span.spanContext();
  if (!trace.isSpanContextValid(spanContext)) return NO_SPAN;
  const created = { traceId: spanContext.traceId, spanId: spanContext.spanId };
  sampleContexts.set(span, created);
  return created;
}

/**
 * pprof's `generateLabels` callback. It runs when a window is serialized, so a
 * root that set its route after the sample was taken is still labelled.
 */
export function sampleLabels({
  context,
}: {
  context?: { context?: object; timestamp: bigint };
}): LabelSet {
  const sample = context?.context;
  if (!context || !isSampleContext(sample)) return {};
  const labels: LabelSet = {
    [TRACE_ID_LABEL]: sample.traceId,
    [SPAN_ID_LABEL]: sample.spanId,
    // Microseconds since the Unix epoch; a number holds them exactly.
    [TIMESTAMP_LABEL]: Number(context.timestamp),
  };
  const root = sample.root;
  if (root) {
    labels[ROOT_SPAN_NAME_ATTRIBUTE] = root.span?.name ?? root.name;
    const route = root.span ? routeOf(root.span) : root.route;
    if (route) labels[HTTP_ROUTE_ATTRIBUTE] = route;
  }
  return labels;
}

function isSampleContext(value: object | undefined): value is SampleContext {
  return value !== undefined && "traceId" in value;
}

function routeOf(span: RecordingSpan) {
  const route = span.attributes[HTTP_ROUTE_ATTRIBUTE];
  return typeof route === "string" ? route : undefined;
}
