// @vitest-environment node
import { randomUUID } from "node:crypto";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { expect, it } from "vite-plus/test";
import type { EventDefinition } from "#app/composition/events.ts";

it("exports a structured log for Graphile admission failures", async () => {
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
  if (endpoint) {
    processors.push(
      new SimpleLogRecordProcessor(new OTLPLogExporter({ url: `${endpoint}/v1/logs` })),
    );
  }
  const loggerProvider = new LoggerProvider({ resource, processors });
  logs.setGlobalLoggerProvider(loggerProvider);
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
      routes: [
        {
          definition,
          job: () => {
            throw new TypeError("Private job payload: secret");
          },
        },
        { definition, job: (event) => ({ task: "verification-consumer", payload: event }) },
      ],
      enqueue: async () => {
        throw new Error("Task 01 forced enqueue rejection");
      },
    });
    await publisher.publish(definition.parse({}));
    await loggerProvider.forceFlush();
    const records = logExporter.getFinishedLogRecords();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      severityNumber: 17,
      body: "business_events.publication.failed",
      attributes: {
        "everr.business_event.failure_stage": "job",
        "everr.business_event.version": 1,
        "exception.type": "TypeError",
        "exception.message": "Business event job construction failed",
      },
    });
    expect(records[0].attributes).not.toHaveProperty("exception.stacktrace");
    expect(JSON.stringify(records[0].attributes)).not.toContain("secret");
    expect(records[1]).toMatchObject({
      severityNumber: 17,
      body: "business_events.publication.failed",
      attributes: {
        "everr.business_event.id": expect.any(String),
        "everr.business_event.subject_id": "verification-user",
        "everr.business_event.type": "verification.created",
        "everr.business_event.version": 1,
        "everr.business_event.failure_stage": "enqueue",
        "everr.business_event.task": "verification-consumer",
        "exception.type": "Error",
        "exception.message": "Task 01 forced enqueue rejection",
        "exception.stacktrace": expect.any(String),
      },
    });
    expect(Object.keys(records[1].attributes).sort()).toEqual(
      [
        "everr.business_event.failure_stage",
        "everr.business_event.id",
        "everr.business_event.subject_id",
        "everr.business_event.task",
        "everr.business_event.type",
        "everr.business_event.version",
        "exception.message",
        "exception.stacktrace",
        "exception.type",
      ].sort(),
    );
    if (endpoint) console.info(`BUSINESS_EVENTS_VERIFICATION_MARKER=${marker}`);
  } finally {
    await loggerProvider.shutdown();
    logs.disable();
  }
});
