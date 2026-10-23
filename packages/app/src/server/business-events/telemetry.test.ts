// @vitest-environment node
import { randomUUID } from "node:crypto";
import { metrics } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} from "@opentelemetry/sdk-metrics";
import { expect, it } from "vite-plus/test";
import type { BusinessEventDefinition } from "#app/composition/business-events.ts";
import { createBusinessEventPublisher } from "./publisher";
import { businessEventSubscriber } from "./subscriber";

it("exports one exception and a bounded failure counter from a rejected subscriber", async () => {
  const marker = `task01-${randomUUID()}`;
  // Optional isolated ingestion proof. Never use a developer's default collector.
  const endpoint = process.env.EVERR_BUSINESS_EVENTS_VERIFY_ENDPOINT;
  const resource = resourceFromAttributes({
    "service.name": "everr-business-events-verification",
    "deployment.environment.name": "test",
  });
  const logExporter = new InMemoryLogRecordExporter();
  const processors = [new SimpleLogRecordProcessor(logExporter)];
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
  const readers = [
    new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 }),
  ];
  if (endpoint) {
    processors.push(
      new SimpleLogRecordProcessor(new OTLPLogExporter({ url: `${endpoint}/v1/logs` })),
    );
    readers.push(
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: 60_000,
      }),
    );
  }
  const loggerProvider = new LoggerProvider({ resource, processors });
  const meterProvider = new MeterProvider({ resource, readers });
  logs.setGlobalLoggerProvider(loggerProvider);
  metrics.setGlobalMeterProvider(meterProvider);
  try {
    const { publicationDiagnostics } = await import("./telemetry");
    const definition: BusinessEventDefinition = {
      type: "verification.created",
      version: 1,
      parse() {
        return {
          type: "verification.created",
          version: 1,
          subjectId: "verification-user",
          data: {},
        };
      },
    };
    const publisher = createBusinessEventPublisher({
      definitions: [definition],
      subscribers: [
        businessEventSubscriber(definition, {
          id: "verification-consumer",
          enqueue() {
            return Promise.reject(new Error("Task 01 forced enqueue rejection"));
          },
        }),
      ],
      diagnostics: publicationDiagnostics,
      metadata: () => ({ id: marker, occurredAt: new Date().toISOString() }),
    });
    publisher.publish(definition.parse({}));
    await publisher.stop();
    await loggerProvider.forceFlush();
    await meterProvider.forceFlush();
    const records = logExporter.getFinishedLogRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      severityNumber: 17,
      body: "business_events.publication.failed",
      attributes: {
        "everr.business_event.id": marker,
        "everr.business_event.subject_id": "verification-user",
        "exception.type": "Error",
        "exception.message": "Task 01 forced enqueue rejection",
        "exception.stacktrace": expect.any(String),
      },
    });
    const exportedMetrics = metricExporter
      .getMetrics()
      .flatMap((resourceMetrics) => resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics));
    expect(exportedMetrics).toHaveLength(1);
    expect(exportedMetrics[0]).toMatchObject({
      descriptor: {
        name: "everr.business_events.publication.failures",
        unit: "1",
        type: "COUNTER",
      },
      dataPoints: [
        {
          value: 1,
          attributes: {
            "everr.business_event.type": "verification.created",
            "everr.business_event.subscriber": "verification-consumer",
            "everr.business_event.failure_stage": "subscriber",
          },
        },
      ],
    });
    expect(Object.keys(records[0].attributes).sort()).toEqual(
      [
        "everr.business_event.failure_stage",
        "everr.business_event.id",
        "everr.business_event.subject_id",
        "everr.business_event.subscriber",
        "everr.business_event.type",
        "exception.message",
        "exception.stacktrace",
        "exception.type",
      ].sort(),
    );
    if (endpoint) console.info(`BUSINESS_EVENTS_VERIFICATION_MARKER=${marker}`);
  } finally {
    await Promise.all([loggerProvider.shutdown(), meterProvider.shutdown()]);
    logs.disable();
    metrics.disable();
  }
});
