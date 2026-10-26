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
import { expect, it, vi } from "vite-plus/test";
import type { EventDefinition } from "#app/composition/events.ts";

it("exports bounded diagnostics for Graphile admission failures", async () => {
  const marker = `task02-${randomUUID()}`;
  // Optional isolated ingestion proof. Never use a developer's default collector.
  const endpoint = process.env.EVERR_BUSINESS_EVENTS_VERIFY_ENDPOINT;
  const resource = resourceFromAttributes({
    "service.name": "everr-business-events-verification",
    "deployment.environment.name": "test",
    "everr.verification.id": marker,
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
  const createCounter = vi.spyOn(
    meterProvider.getMeter("everr-app.business-events"),
    "createCounter",
  );
  try {
    const { createEventPublisher } = await import("./publisher");
    const definition: EventDefinition = {
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
    const publisher = createEventPublisher({
      routes: [{ definition, job: (event) => ({ task: "verification-consumer", payload: event }) }],
      enqueue: async () => {
        throw new Error("Task 01 forced enqueue rejection");
      },
    });
    await publisher.publish(definition.parse({}));
    await loggerProvider.forceFlush();
    await meterProvider.forceFlush();
    const records = logExporter.getFinishedLogRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      severityNumber: 17,
      body: "business_events.publication.failed",
      attributes: {
        "everr.business_event.id": expect.any(String),
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
            "everr.business_event.subscriber": "verification.created",
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
    const { serverLogger } = await import("#app/telemetry/logger.ts");
    const counter = createCounter.mock.results[0].value;
    const error = vi.spyOn(serverLogger, "error").mockImplementationOnce(() => {
      throw new Error("logger unavailable");
    });
    await expect(publisher.publish(definition.parse({}))).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    await meterProvider.forceFlush();
    expect(metricExporter.getMetrics().at(-1)?.scopeMetrics[0].metrics[0]).toMatchObject({
      descriptor: { name: "everr.business_events.publication.failures" },
      dataPoints: [
        { value: 1, attributes: { "everr.business_event.failure_stage": "subscriber" } },
      ],
    });
    const add = vi.spyOn(counter, "add").mockImplementationOnce(() => {
      throw new Error("counter unavailable");
    });
    await expect(publisher.publish(definition.parse({}))).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledOnce();
    await loggerProvider.forceFlush();
    expect(logExporter.getFinishedLogRecords().at(-1)).toMatchObject({
      body: "business_events.publication.failed",
      attributes: { "everr.business_event.failure_stage": "subscriber" },
    });
    add.mockRestore();
    error.mockRestore();
    if (endpoint) console.info(`BUSINESS_EVENTS_VERIFICATION_MARKER=${marker}`);
  } finally {
    await Promise.all([loggerProvider.shutdown(), meterProvider.shutdown()]);
    createCounter.mockRestore();
    vi.restoreAllMocks();
    logs.disable();
    metrics.disable();
  }
});
