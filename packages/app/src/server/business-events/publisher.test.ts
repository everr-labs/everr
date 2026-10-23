// @vitest-environment node
import { afterEach, expect, expectTypeOf, it, vi } from "vite-plus/test";
import { z } from "zod";
import type {
  BusinessEvent,
  BusinessEventDefinition,
  BusinessEvents,
} from "#app/composition/business-events.ts";
import { createBusinessEventPublisher, type PublicationDiagnostics } from "./publisher";
import { businessEventSubscriber } from "./subscriber";

// This definition belongs to this test feature. Production facts arrive in later tickets.
const schema = z.object({
  type: z.literal("test.created"),
  version: z.literal(1),
  subjectId: z.string().min(1),
  actorId: z.string().optional(),
  data: z.object({ userId: z.string() }),
});
type Fact = z.infer<typeof schema>;
const definition: BusinessEventDefinition<Fact> = {
  type: "test.created",
  version: 1,
  parse: (input) => schema.parse(input),
};
const fact: Fact = {
  type: "test.created",
  version: 1,
  subjectId: "user-1",
  data: { userId: "user-1" },
};
const envelope = { id: "event-1", occurredAt: "2026-10-23T10:00:00.000Z" };
const deferred = () => {
  let release!: () => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, resolve: release, reject: fail };
};
function setup(
  handlers: ((event: BusinessEvent<Fact>) => void | Promise<void>)[],
  extras: {
    maxInFlight?: number;
    drainTimeoutMs?: number;
    diagnostics?: PublicationDiagnostics;
    metadata?: () => typeof envelope;
  } = {},
) {
  const diagnostics = { log: vi.fn(), count: vi.fn() };
  const publisher = createBusinessEventPublisher({
    definitions: [definition],
    subscribers: handlers.map((enqueue, i) =>
      businessEventSubscriber(definition, { id: `consumer-${i}`, enqueue }),
    ),
    diagnostics,
    metadata: () => envelope,
    ...extras,
  });
  return { ...publisher, diagnostics };
}
afterEach(() => vi.useRealTimers());

it("returns void before any consumer executes and drains accepted work", async () => {
  const waiting = deferred();
  const handler = vi.fn(() => waiting.promise);
  const publisher = setup([handler]);
  expect(publisher.publish(fact)).toBeUndefined();
  expect(handler).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(handler).toHaveBeenCalledWith({ ...fact, ...envelope });
  let drained = false;
  const stopping = publisher.stop().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  waiting.resolve();
  await stopping;
  expect(drained).toBe(true);
});

it("contains synchronous and asynchronous consumer failures independently", async () => {
  const good = vi.fn();
  const publisher = setup([
    () => {
      throw new Error("sync failure");
    },
    () => Promise.reject(new Error("async failure")),
    good,
  ]);
  publisher.publish(fact);
  await publisher.stop();
  expect(good).toHaveBeenCalledOnce();
  expect(
    publisher.diagnostics.log.mock.calls.map(([failure]) => [
      failure.subscriberId,
      failure.error.message,
    ]),
  ).toEqual([
    ["consumer-0", "sync failure"],
    ["consumer-1", "async failure"],
  ]);
  expect(publisher.diagnostics.count).toHaveBeenCalledTimes(2);
  expect(publisher.diagnostics.log).toHaveBeenCalledWith(
    expect.objectContaining({
      eventId: "event-1",
      eventType: "test.created",
      subjectId: "user-1",
      stage: "subscriber",
    }),
  );
});

it("attempts siblings even while another subscriber is unresolved", async () => {
  const waiting = deferred();
  const good = vi.fn();
  const publisher = setup([() => waiting.promise, good]);
  publisher.publish(fact);
  await Promise.resolve();
  expect(good).toHaveBeenCalledOnce();
  waiting.reject(new Error("late failure"));
  await publisher.stop();
  expect(publisher.diagnostics.count).toHaveBeenCalledOnce();
});

it("never changes source success or catches a source mutation failure", async () => {
  const publisher = setup([() => Promise.reject(new Error("enqueue failed"))]);
  const source = vi.fn().mockResolvedValue({ id: "user-1" });
  async function createUser() {
    const user = await source(); // The authoritative operation has completed.
    publisher.publish(fact);
    return user;
  }
  await expect(createUser()).resolves.toEqual({ id: "user-1" });
  await publisher.stop();
  source.mockRejectedValueOnce(new Error("source failed"));
  await expect(createUser()).rejects.toThrow("source failed");
  expect(publisher.diagnostics.count).toHaveBeenCalledTimes(1);
});

it("contains payload and envelope validation without logging payloads", async () => {
  const handler = vi.fn();
  const publisher = setup([handler]);
  publisher.publish({ ...fact, data: { userId: 3 } } as unknown as Fact);
  publisher.publish({ ...fact, type: "unbounded-user-input" } as unknown as Fact);
  publisher.publish({
    get type(): never {
      throw new Error("getter failed");
    },
  } as unknown as Fact);
  await publisher.stop();
  expect(handler).not.toHaveBeenCalled();
  expect(publisher.diagnostics.count).toHaveBeenCalledTimes(3);
  expect(publisher.diagnostics.log.mock.calls[0][0].error.message).toBe(
    "Business event validation failed",
  );
  expect(publisher.diagnostics.log.mock.calls[1][0].eventType).toBe("unknown");
  const brokenMetadata = setup([handler], {
    metadata: () => {
      throw new Error("metadata failed");
    },
  });
  expect(() => brokenMetadata.publish(fact)).not.toThrow();
  expect(brokenMetadata.diagnostics.log).toHaveBeenCalledWith(
    expect.objectContaining({ stage: "envelope" }),
  );
  await brokenMetadata.stop();
});

it("guards synchronous and rejected diagnostics independently", async () => {
  const log = vi.fn(() => {
    throw new Error("logger failed");
  });
  const count = vi.fn(() => Promise.reject(new Error("meter failed")));
  const good = vi.fn();
  const publisher = setup(
    [
      () => {
        throw new Error("subscriber failed");
      },
      good,
    ],
    { diagnostics: { log, count } },
  );
  expect(() => publisher.publish(fact)).not.toThrow();
  await publisher.stop();
  await new Promise((resolve) => setImmediate(resolve)); // Unhandled rejections would fail this test.
  expect(log).toHaveBeenCalledOnce();
  expect(count).toHaveBeenCalledOnce();
  expect(good).toHaveBeenCalledOnce();
});

it("drops overload without a queue and releases capacity after settlement", async () => {
  const waiting = deferred();
  const handler = vi.fn().mockImplementationOnce(() => waiting.promise);
  const publisher = setup([handler], { maxInFlight: 1 });
  publisher.publish(fact);
  publisher.publish(fact);
  await Promise.resolve();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(publisher.diagnostics.log).toHaveBeenCalledWith(
    expect.objectContaining({ stage: "overload", subscriberId: "publisher" }),
  );
  waiting.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  publisher.publish(fact);
  await publisher.stop();
  expect(handler).toHaveBeenCalledTimes(2);
});

it("bounds shutdown, closes admission, and handles rejection after the timeout", async () => {
  vi.useFakeTimers();
  const waiting = deferred();
  const handler = vi.fn(() => waiting.promise);
  const publisher = setup([handler], { drainTimeoutMs: 25 });
  publisher.publish(fact);
  const stop = publisher.stop();
  expect(publisher.stop()).toBe(stop);
  publisher.publish(fact);
  await vi.advanceTimersByTimeAsync(25);
  await stop;
  expect(handler).toHaveBeenCalledOnce();
  expect(publisher.diagnostics.log.mock.calls.map(([failure]) => failure.stage)).toEqual([
    "closed",
    "drain",
  ]);
  waiting.reject(new Error("late enqueue rejection"));
  await vi.advanceTimersByTimeAsync(0);
  expect(publisher.diagnostics.log).toHaveBeenLastCalledWith(
    expect.objectContaining({ stage: "subscriber" }),
  );
});

it("makes an empty registry a no-op without metadata or diagnostics", async () => {
  const metadata = vi.fn(() => {
    throw new Error("must not be called");
  });
  const diagnostics = { log: vi.fn(), count: vi.fn() };
  const publisher = createBusinessEventPublisher({
    definitions: [],
    subscribers: [],
    diagnostics,
    metadata,
  });
  publisher.publish(fact);
  await publisher.stop();
  publisher.publish(fact);
  expect(metadata).not.toHaveBeenCalled();
  expect(diagnostics.log).not.toHaveBeenCalled();
});

it("routes only compatible event versions and normalizes metadata inside publication", async () => {
  const other: BusinessEventDefinition = {
    type: "other.created",
    version: 1,
    parse: () => ({ ...fact, type: "other.created" }),
  };
  const wrong = vi.fn();
  const right = vi.fn();
  const publisher = createBusinessEventPublisher({
    definitions: [definition, other],
    subscribers: [
      businessEventSubscriber(definition, { id: "right", enqueue: right }),
      businessEventSubscriber(other, { id: "wrong", enqueue: wrong }),
    ],
    diagnostics: { log() {}, count() {} },
  });
  publisher.publish(fact);
  await publisher.stop();
  expect(wrong).not.toHaveBeenCalled();
  expect(right).toHaveBeenCalledWith(
    expect.objectContaining({ ...fact, id: expect.any(String), occurredAt: expect.any(String) }),
  );
  expect(right.mock.calls[0][0]).not.toHaveProperty("actorId");
});

it("delivers valid facts whose feature schema rejects unknown envelope fields", async () => {
  const strictDefinition: BusinessEventDefinition<Fact> = {
    ...definition,
    parse: (input) => schema.strict().parse(input),
  };
  const enqueue = vi.fn();
  const diagnostics = { log: vi.fn(), count: vi.fn() };
  const publisher = createBusinessEventPublisher({
    definitions: [strictDefinition],
    subscribers: [businessEventSubscriber(strictDefinition, { id: "strict", enqueue })],
    diagnostics,
    metadata: () => envelope,
  });
  publisher.publish(fact);
  await publisher.stop();
  expect(enqueue).toHaveBeenCalledWith({ ...fact, ...envelope });
  expect(diagnostics.count).not.toHaveBeenCalled();
});

it("rejects ambiguous static registrations before serving producers", () => {
  const diagnostics = { log() {}, count() {} };
  expect(() =>
    createBusinessEventPublisher({
      definitions: [definition, definition],
      subscribers: [],
      diagnostics,
    }),
  ).toThrow("Duplicate business event definition");
  const subscriber = businessEventSubscriber(definition, { id: "same", enqueue() {} });
  expect(() =>
    createBusinessEventPublisher({
      definitions: [definition],
      subscribers: [subscriber, subscriber],
      diagnostics,
    }),
  ).toThrow("unique and nonempty");
  expect(() =>
    createBusinessEventPublisher({ definitions: [], subscribers: [subscriber], diagnostics }),
  ).toThrow("Unregistered");
});

it("keeps producer and subscriber payloads typed by their owning feature", async () => {
  const publisher = setup([]);
  const typed: BusinessEvents<Fact> = publisher;
  expectTypeOf(typed.publish).parameter(0).toEqualTypeOf<Fact>();
  const incompatible: Parameters<typeof typed.publish>[0] = {
    ...fact,
    // @ts-expect-error A producer cannot publish a payload from a different feature.
    data: { otherId: "wrong-feature" },
  };
  expect(incompatible).toBeDefined();
  const subscriber = businessEventSubscriber(definition, {
    id: "typed-consumer",
    enqueue(event) {
      expectTypeOf(event.data).toEqualTypeOf<{ userId: string }>();
    },
  });
  await subscriber.enqueue({ ...fact, ...envelope });
  await publisher.stop();
});
