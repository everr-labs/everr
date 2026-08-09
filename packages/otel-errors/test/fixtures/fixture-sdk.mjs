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

class StdoutLogExporter {
  export(records, resultCallback) {
    for (const record of records) {
      writeLine({
        kind: "log",
        body: record.body,
        eventName: record.eventName,
        severityNumber: record.severityNumber,
        mechanism: record.attributes["everr.error.mechanism"],
      });
    }
    resultCallback({ code: 0 });
  }

  shutdown() {
    return Promise.resolve();
  }

  forceFlush() {
    return Promise.resolve();
  }
}

class StdoutMetricExporter {
  export(metrics, resultCallback) {
    for (const scope of metrics.scopeMetrics ?? []) {
      for (const metric of scope.metrics ?? []) {
        writeLine({ kind: "metric", name: metric.descriptor.name });
      }
    }
    resultCallback({ code: 0 });
  }

  shutdown() {
    return Promise.resolve();
  }

  forceFlush() {
    return Promise.resolve();
  }
}

class StdoutSpanExporter {
  export(spans, resultCallback) {
    for (const span of spans) {
      writeLine({ kind: "span", name: span.name });
    }
    resultCallback({ code: 0 });
  }

  shutdown() {
    return Promise.resolve();
  }

  forceFlush() {
    return Promise.resolve();
  }
}

/** Registers the SDK exactly as an application does, and returns it. */
export function startSdk(config = {}) {
  const sdk = new NodeSDK({
    logRecordProcessors: [
      new BatchLogRecordProcessor(new StdoutLogExporter(), NEVER_ON_A_TIMER),
    ],
    spanProcessors: [
      new BatchSpanProcessor(new StdoutSpanExporter(), NEVER_ON_A_TIMER),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new StdoutMetricExporter(),
        exportIntervalMillis: 300_000,
      }),
    ],
    instrumentations: [new ErrorsInstrumentation(config)],
  });
  sdk.start();
  return sdk;
}
