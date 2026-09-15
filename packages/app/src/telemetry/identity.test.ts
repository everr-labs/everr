// @vitest-environment node
import { context, propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeEach, expect, it } from "vitest";
import {
  createIdentityLogProcessor,
  createIdentitySpanProcessor,
  mergeTelemetryIdentity,
  withTelemetryIdentityScope,
} from "./identity";

const spans = new InMemorySpanExporter();
const records = new InMemoryLogRecordExporter();
const tracerProvider = new NodeTracerProvider({
  spanProcessors: [
    createIdentitySpanProcessor(),
    new SimpleSpanProcessor(spans),
  ],
});
tracerProvider.register();
const logProvider = new LoggerProvider({
  processors: [
    createIdentityLogProcessor(),
    new SimpleLogRecordProcessor(records),
  ],
});
const tracer = trace.getTracer("identity-test");
const logger = logProvider.getLogger("identity-test");
beforeEach(() => {
  spans.reset();
  records.reset();
});
afterAll(async () => {
  await tracerProvider.shutdown();
  await logProvider.shutdown();
});

it("isolates concurrent requests and annotates the root when auth resolves inside a child", async () => {
  let release!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  await Promise.all(
    ["a", "b"].map((id) =>
      context.with(ROOT_CONTEXT, () =>
        withTelemetryIdentityScope(() =>
          tracer.startActiveSpan(`request-${id}`, async (root) => {
            await tracer.startActiveSpan(`auth-${id}`, async (auth) => {
              mergeTelemetryIdentity({
                organizationId: `org-${id}`,
                userId: `user-${id}`,
              });
              if (++started === 2) release();
              await bothStarted;
              await tracer.startActiveSpan(`database-${id}`, async (child) => {
                logger.emit({ body: id });
                child.end();
              });
              auth.end();
            });
            root.end();
          }),
        ),
      ),
    ),
  );
  for (const span of spans.getFinishedSpans()) {
    const id = span.name.slice(-1);
    expect(span.attributes).toMatchObject({
      "everr.organization.id": `org-${id}`,
      "user.id": `user-${id}`,
    });
  }
  for (const record of records.getFinishedLogRecords()) {
    expect(record.attributes).toEqual({
      "everr.organization.id": `org-${record.body}`,
      "user.id": `user-${record.body}`,
    });
  }
});

it("leaves anonymous work and new background scopes free of user identity", async () => {
  await withTelemetryIdentityScope(() =>
    tracer.startActiveSpan("request", async (root) => {
      mergeTelemetryIdentity({ organizationId: "org-a", userId: "user-a" });
      await context.with(ROOT_CONTEXT, () =>
        withTelemetryIdentityScope(() =>
          tracer.startActiveSpan("job", async (job) => {
            mergeTelemetryIdentity({ organizationId: "org-b" });
            tracer.startActiveSpan("job-child", (child) => child.end());
            logger.emit({ body: "job" });
            job.end();
          }),
        ),
      );
      root.end();
    }),
  );
  await withTelemetryIdentityScope(() =>
    tracer.startActiveSpan("anonymous", (span) => span.end()),
  );
  for (const span of spans
    .getFinishedSpans()
    .filter((span) => span.name.startsWith("job"))) {
    expect(span.attributes).toEqual({ "everr.organization.id": "org-b" });
  }
  expect(
    spans.getFinishedSpans().find((span) => span.name === "anonymous")
      ?.attributes,
  ).toEqual({});
  expect(records.getFinishedLogRecords()[0].attributes).toEqual({
    "everr.organization.id": "org-b",
  });
});

it("does not backfill ended pre-auth spans or create baggage", async () => {
  await withTelemetryIdentityScope(() =>
    tracer.startActiveSpan("request", async (root) => {
      tracer.startActiveSpan("pre-auth", (span) => span.end());
      mergeTelemetryIdentity({ organizationId: "org-a", userId: "user-a" });
      expect(propagation.getBaggage(context.active())).toBeUndefined();
      logger.emit({
        body: "explicit",
        attributes: { "everr.organization.id": "other-org" },
      });
      root.end();
    }),
  );
  expect(
    spans.getFinishedSpans().find((span) => span.name === "pre-auth")
      ?.attributes,
  ).toEqual({});
  expect(records.getFinishedLogRecords()[0].attributes).toEqual({
    "everr.organization.id": "other-org",
    "user.id": "user-a",
  });
});

it("merges verified fields and retains fields omitted by later calls", () => {
  withTelemetryIdentityScope(() =>
    tracer.startActiveSpan("request", (root) => {
      mergeTelemetryIdentity({ userId: "user-a", organizationId: "org-a" });
      mergeTelemetryIdentity({ organizationId: "org-b", userId: undefined });
      tracer.startActiveSpan("child", (span) => span.end());
      logger.emit({ body: "merged" });
      root.end();
    }),
  );
  for (const span of spans.getFinishedSpans()) {
    expect(span.attributes).toEqual({
      "user.id": "user-a",
      "everr.organization.id": "org-b",
    });
  }
  expect(records.getFinishedLogRecords()[0].attributes).toEqual({
    "user.id": "user-a",
    "everr.organization.id": "org-b",
  });
});

it("continues a remote trace without trusting baggage or annotating its remote parent", async () => {
  const incoming = propagation.setBaggage(
    trace.setSpanContext(ROOT_CONTEXT, {
      traceId: "11111111111111111111111111111111",
      spanId: "2222222222222222",
      traceFlags: 1,
      isRemote: true,
    }),
    propagation.createBaggage({
      "user.id": { value: "spoofed-user" },
      "everr.organization.id": { value: "spoofed-org" },
    }),
  );
  await context.with(incoming, () =>
    withTelemetryIdentityScope(() =>
      tracer.startActiveSpan("remote-request", async (root) => {
        await tracer.startActiveSpan("auth", async (auth) => {
          mergeTelemetryIdentity({
            organizationId: "verified-org",
            userId: "verified-user",
          });
          auth.end();
        });
        root.end();
      }),
    ),
  );
  const root = spans
    .getFinishedSpans()
    .find((span) => span.name === "remote-request");
  expect(root?.spanContext().traceId).toBe("11111111111111111111111111111111");
  expect(root?.attributes).toEqual({
    "everr.organization.id": "verified-org",
    "user.id": "verified-user",
  });
});
