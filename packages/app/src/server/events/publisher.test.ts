// @vitest-environment node
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { createEventPublisher } from "./publisher";

const diagnostics = vi.hoisted(() => vi.fn());
vi.mock("#app/telemetry/logger.ts", () => ({
  serverLogger: { error: diagnostics },
  exceptionAttributes: (error: Error) => ({ "exception.message": error.message }),
}));
beforeEach(() => diagnostics.mockReset());

const schema = z
  .object({
    type: z.literal("test.created"),
    version: z.literal(1),
    subjectId: z.string().min(1),
    data: z.object({ userId: z.string() }).strict(),
  })
  .strict();
const definition = {
  type: "test.created",
  version: 1,
  parse: (input: unknown) => schema.parse(input),
};
const fact = { type: "test.created", version: 1, subjectId: "u", data: { userId: "u" } } as const;
const route = {
  definition,
  job: (event: unknown) => ({ task: "test/handle", payload: event, spec: { maxAttempts: 3 } }),
};

it("directly enqueues the validated event and waits for Graphile persistence", async () => {
  let release!: () => void;
  const enqueue = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const publisher = createEventPublisher({ routes: [route], enqueue });
  let finished = false;
  const publishing = publisher.publish(fact).then(() => {
    finished = true;
  });
  expect(enqueue).toHaveBeenCalledWith(
    "test/handle",
    {
      ...fact,
      id: expect.any(String),
      occurredAt: expect.any(String),
    },
    { maxAttempts: 3 },
  );
  await Promise.resolve();
  expect(finished).toBe(false);
  release();
  await publishing;
  expect(finished).toBe(true);
});

it("ignores events with no configured job, including unhandled versions", async () => {
  const enqueue = vi.fn();
  const events = createEventPublisher({ routes: [route], enqueue });
  await events.publish({ ...fact, type: "organization.provisioned" });
  await events.publish({ ...fact, version: 2 });
  expect(enqueue).not.toHaveBeenCalled();
  expect(diagnostics).not.toHaveBeenCalled();
});

it("rejects invalid data without leaking schema input to diagnostics", async () => {
  const enqueue = vi.fn();
  const events = createEventPublisher({ routes: [route], enqueue });
  await events.publish({ ...fact, data: { privateProfile: "secret" } });
  expect(enqueue).not.toHaveBeenCalled();
  expect(diagnostics).toHaveBeenCalledWith(
    "business_events.publication.failed",
    expect.objectContaining({
      "everr.business_event.type": fact.type,
      "everr.business_event.version": 1,
      "everr.business_event.failure_stage": "validation",
      "exception.message": "Business event validation failed",
    }),
  );
  expect(diagnostics.mock.calls[0][1]).not.toHaveProperty("everr.business_event.task");
  expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("secret");
});

it("labels job construction failures before Graphile admission", async () => {
  const enqueue = vi.fn();
  const events = createEventPublisher({
    routes: [
      {
        ...route,
        job: () => {
          throw new TypeError("Private job payload: secret");
        },
      },
    ],
    enqueue,
  });
  await expect(events.publish(fact)).resolves.toBeUndefined();
  expect(enqueue).not.toHaveBeenCalled();
  expect(diagnostics).toHaveBeenCalledWith(
    "business_events.publication.failed",
    expect.objectContaining({
      "everr.business_event.type": fact.type,
      "everr.business_event.version": 1,
      "everr.business_event.failure_stage": "job",
      "exception.type": "TypeError",
      "exception.message": "Business event job construction failed",
    }),
  );
  expect(diagnostics.mock.calls[0][1]).not.toHaveProperty("everr.business_event.task");
  expect(diagnostics.mock.calls[0][1]).not.toHaveProperty("exception.stacktrace");
  expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("secret");
});

it.each(["throw", "reject"])(
  "contains Graphile failures (%s) and attempts other jobs",
  async (kind) => {
    const enqueue = vi
      .fn(async () => {})
      .mockImplementationOnce(() => {
        if (kind === "throw") throw new Error("Graphile unavailable");
        return Promise.reject(new Error("Graphile unavailable"));
      });
    const events = createEventPublisher({
      routes: [route, { ...route, job: () => ({ task: "other", payload: {} }) }],
      enqueue,
    });
    await expect(events.publish(fact)).resolves.toBeUndefined();
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(diagnostics).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledWith(
      "business_events.publication.failed",
      expect.objectContaining({
        "everr.business_event.failure_stage": "enqueue",
        "everr.business_event.task": "test/handle",
      }),
    );
  },
);

it("contains logger failures without rejecting publication", async () => {
  diagnostics.mockImplementationOnce(() => {
    throw new Error("logger unavailable");
  });
  const events = createEventPublisher({
    routes: [route],
    enqueue: async () => {
      throw new Error("Graphile unavailable");
    },
  });
  await expect(events.publish(fact)).resolves.toBeUndefined();
  expect(diagnostics).toHaveBeenCalledOnce();
});
