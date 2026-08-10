import { metrics, trace } from "@opentelemetry/api";
import { startSdk } from "./fixture-sdk.mjs";

startSdk();

// Ends a span that stays queued in the batch processor. It can only reach
// stdout if the fatal path flushes the TracerProvider as well as the logs.
trace.getTracer("fixture").startSpan("pre-crash").end();

// Same for a metric: the reader's interval is far longer than this process
// lives, so it can only reach stdout if the fatal path flushes the meter.
metrics.getMeter("fixture").createCounter("pre_crash_total").add(1);

setTimeout(() => {
  throw new Error("fixture-crash");
}, 10);
