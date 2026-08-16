import { metrics, trace } from "@opentelemetry/api";
import { startSdk } from "./fixture-sdk.mjs";

startSdk();

// Ends a span that stays in the queue of the batch processor. The span goes to
// stdout only if the fatal path flushes the TracerProvider and the logs.
trace.getTracer("fixture").startSpan("pre-crash").end();

// A metric is the same. The interval of the reader is much longer than the
// life of this process. Thus the metric goes to stdout only if the fatal path
// flushes the meter.
metrics.getMeter("fixture").createCounter("pre_crash_total").add(1);

setTimeout(() => {
  throw new Error("fixture-crash");
}, 10);
