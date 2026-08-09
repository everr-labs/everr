import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ErrorsInstrumentation } from "../../dist/node.js";

// Batch processors with a delay far longer than the fixture's life: nothing
// reaches stdout unless the fatal path's forceFlush delivers it. A simple
// processor would pass these tests without a flush at all.
const NEVER_ON_A_TIMER = { scheduledDelayMillis: 300_000 };

function writeLine(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/** An exporter that writes one JSON line per payload produced by `toPayloads`. */
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

/** Registers the SDK exactly as an application does, and returns it. */
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
