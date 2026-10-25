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
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { expect, it, vi } from "vite-plus/test";

it("exports bounded milestone diagnostics and keeps log and counter failures independent", async () => {
  const marker = `milestones-${randomUUID()}`;
  const endpoint = process.env.EVERR_MILESTONE_VERIFY_ENDPOINT;
  const resource = resourceFromAttributes({
    "service.name": "everr-milestones-verification",
    "deployment.environment.name": "test",
    "everr.verification.id": marker,
  });
  const logExporter = new InMemoryLogRecordExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
  const processors = [new SimpleLogRecordProcessor(logExporter)];
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
  const logger = new LoggerProvider({ resource, processors });
  const meter = new MeterProvider({ resource, readers });
  logs.setGlobalLoggerProvider(logger);
  metrics.setGlobalMeterProvider(meter);
  const createCounter = vi.spyOn(
    meter.getMeter("everr-cloud.organization-milestones"),
    "createCounter",
  );
  try {
    const { milestoneDiagnostic } = await import("./telemetry");
    const { createTraceConsultations } = await import("./milestones");
    const observer = createTraceConsultations({
      store: {
        establish: async () => {
          throw new Error("private database detail");
        },
      },
      events: { publish() {} },
    });
    const observation = {
      principal: { kind: "client" as const, organizationId: "org", clientId: "fixture-client" },
      surface: "mcp" as const,
      traces: [
        {
          traceId: "trace",
          serviceName: "checkout",
          resourceAttributes: { "deployment.environment.name": "production" },
          spanAttributes: {},
        },
      ],
    };
    observer.observe({ ...observation, traces: [] });
    observer.observe(observation);
    await observer.stop();
    await logger.forceFlush();
    await meter.forceFlush();
    expect(logExporter.getFinishedLogRecords()).toMatchObject([
      {
        severityNumber: 17,
        body: "organization.milestones.failed",
        attributes: { "everr.milestone.failure_stage": "validation" },
      },
      {
        severityNumber: 17,
        body: "organization.milestones.failed",
        attributes: { "everr.milestone.failure_stage": "storage" },
      },
    ]);
    expect(JSON.stringify(logExporter.getFinishedLogRecords())).not.toContain(
      "private database detail",
    );
    expect(Object.keys(logExporter.getFinishedLogRecords()[0].attributes)).toEqual([
      "everr.milestone.failure_stage",
    ]);
    expect(metricExporter.getMetrics()[0].scopeMetrics[0].metrics[0]).toMatchObject({
      descriptor: { name: "everr.organization_milestones.failures", unit: "1", type: "COUNTER" },
      dataPoints: expect.arrayContaining([
        {
          value: 1,
          attributes: { "everr.milestone.failure_stage": "validation" },
          startTime: expect.any(Array),
          endTime: expect.any(Array),
        },
        {
          value: 1,
          attributes: { "everr.milestone.failure_stage": "storage" },
          startTime: expect.any(Array),
          endTime: expect.any(Array),
        },
      ]),
    });
    const { serverLogger } = await import("@everr/app/telemetry/logger");
    const error = vi.spyOn(serverLogger, "error").mockImplementationOnce(() => {
      throw new Error("logger unavailable");
    });
    expect(() => milestoneDiagnostic("closed")).not.toThrow();
    expect(error).toHaveBeenCalledOnce();
    await meter.forceFlush();
    expect(metricExporter.getMetrics().at(-1)!.scopeMetrics[0].metrics[0]).toMatchObject({
      dataPoints: [{ value: 1, attributes: { "everr.milestone.failure_stage": "closed" } }],
    });
    const counter = createCounter.mock.results[0].value;
    const add = vi.spyOn(counter, "add").mockImplementationOnce(() => {
      throw new Error("counter unavailable");
    });
    expect(() => milestoneDiagnostic("drain")).not.toThrow();
    expect(add).toHaveBeenCalledOnce();
    await logger.forceFlush();
    expect(logExporter.getFinishedLogRecords().at(-1)).toMatchObject({
      body: "organization.milestones.failed",
      attributes: { "everr.milestone.failure_stage": "drain" },
    });
    if (endpoint) console.info(`MILESTONE_VERIFICATION_MARKER=${marker}`);
  } finally {
    vi.restoreAllMocks();
    await Promise.all([logger.shutdown(), meter.shutdown()]);
    logs.disable();
    metrics.disable();
  }
});
