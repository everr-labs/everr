import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ErrorsInstrumentation } from "../../dist/node.js";

// The batch processors have a delay that is much longer than the life of this
// fixture. Thus no data goes to stdout if the forceFlush of the fatal path
// does not send it. A simple processor makes these tests correct without a
// flush.
const NEVER_ON_A_TIMER = { scheduledDelayMillis: 300_000 };

function writeLine(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/** An exporter that writes one JSON line for each payload from `toPayloads`. */
function stdoutExporter(toPayloads) {
  return {
    export(batch, resultCallback) {
      for (const payload of toPayloads(batch)) {
        writeLine(payload);
      }
      resultCallback({ code: 0 });
    },
    shutdown() {
      return Promise.resolve();
    },
    forceFlush() {
      return Promise.resolve();
    },
  };
}

const stdoutLogExporter = () =>
  stdoutExporter((records) =>
    records.map((record) => ({
      kind: "log",
      body: record.body,
      eventName: record.eventName,
      severityNumber: record.severityNumber,
      mechanism: record.attributes["everr.error.mechanism"],
    })),
  );

const stdoutMetricExporter = () =>
  stdoutExporter((metrics) =>
    (metrics.scopeMetrics ?? []).flatMap((scope) =>
      (scope.metrics ?? []).map((metric) => ({
        kind: "metric",
        name: metric.descriptor.name,
      })),
    ),
  );

const stdoutSpanExporter = () =>
  stdoutExporter((spans) => spans.map((span) => ({ kind: "span", name: span.name })));

/** Registers the SDK as an application registers it, then returns the SDK. */
export function startSdk(config = {}) {
  const sdk = new NodeSDK({
    logRecordProcessors: [
      new BatchLogRecordProcessor(stdoutLogExporter(), NEVER_ON_A_TIMER),
    ],
    spanProcessors: [
      new BatchSpanProcessor(stdoutSpanExporter(), NEVER_ON_A_TIMER),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: stdoutMetricExporter(),
        exportIntervalMillis: 300_000,
      }),
    ],
    instrumentations: [new ErrorsInstrumentation(config)],
  });
  sdk.start();
  return sdk;
}
