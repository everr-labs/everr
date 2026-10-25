// @vitest-environment node
import { afterEach, expect, expectTypeOf, it, vi } from "vite-plus/test";
import { z } from "zod";
import type { PublishedEvent, EventDefinition, EventPublisher } from "#app/composition/events.ts";
import { createEventPublisher } from "./publisher";
import type { PublicationDiagnostics } from "./diagnostics";
import { eventRegistration } from "./registration";

// This definition belongs to this test feature. Production facts arrive in later tickets.
const schema = z.object({
  type: z.literal("test.created"),
  version: z.literal(1),
  subjectId: z.string().min(1),
  actorId: z.string().optional(),
  data: z.object({ userId: z.string() }),
});
type Fact = z.infer<typeof schema>;
const definition: EventDefinition<Fact> = {
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
  handlers: ((event: PublishedEvent<Fact>) => void | Promise<void>)[],
  extras: {
    maxInFlight?: number;
    drainTimeoutMs?: number;
    diagnostics?: PublicationDiagnostics;
    metadata?: () => typeof envelope;
  } = {},
) {
  const diagnostics = { log: vi.fn(), count: vi.fn() };
  const publisher = createEventPublisher({
    registrations: [
      eventRegistration(
        definition,
        ...handlers.map((enqueue, i) => ({ id: `consumer-${i}`, enqueue })),
      ),
    ],
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
  const publisher = createEventPublisher({
    registrations: [],
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
  const other: EventDefinition = {
    type: "other.created",
    version: 1,
    parse: () => ({ ...fact, type: "other.created" }),
  };
  const wrong = vi.fn();
  const right = vi.fn();
  const publisher = createEventPublisher({
    registrations: [
      eventRegistration(definition, { id: "right", enqueue: right }),
      eventRegistration(other, { id: "wrong", enqueue: wrong }),
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
  const strictDefinition: EventDefinition<Fact> = {
    ...definition,
    parse: (input) => schema.strict().parse(input),
  };
  const enqueue = vi.fn();
  const diagnostics = { log: vi.fn(), count: vi.fn() };
  const publisher = createEventPublisher({
    registrations: [eventRegistration(strictDefinition, { id: "strict", enqueue })],
    diagnostics,
    metadata: () => envelope,
  });
  publisher.publish(fact);
  await publisher.stop();
  expect(enqueue).toHaveBeenCalledWith({ ...fact, ...envelope });
  expect(diagnostics.count).not.toHaveBeenCalled();
});

it("rejects conflicting definitions and duplicate consumer IDs before serving producers", () => {
  const diagnostics = { log() {}, count() {} };
  expect(() =>
    createEventPublisher({
      registrations: [eventRegistration(definition), eventRegistration({ ...definition })],
      diagnostics,
    }),
  ).toThrow("Conflicting business event definition");
  const registration = eventRegistration(definition, { id: "same", enqueue() {} });
  expect(() =>
    createEventPublisher({ registrations: [registration, registration], diagnostics }),
  ).toThrow("unique and nonempty");
  expect(() =>
    createEventPublisher({
      registrations: [eventRegistration(definition, { id: "", enqueue() {} })],
      diagnostics,
    }),
  ).toThrow("unique and nonempty");
});

it("keeps producer and subscriber payloads typed by their owning feature", async () => {
  const publisher = setup([]);
  const typed: EventPublisher<Fact> = publisher;
  expectTypeOf(typed.publish).parameter(0).toEqualTypeOf<Fact>();
  const incompatible: Parameters<typeof typed.publish>[0] = {
    ...fact,
    // @ts-expect-error A producer cannot publish a payload from a different feature.
    data: { otherId: "wrong-feature" },
  };
  expect(incompatible).toBeDefined();
  const subscriber = eventRegistration(definition, {
    id: "typed-consumer",
    enqueue(event) {
      expectTypeOf(event.data).toEqualTypeOf<{ userId: string }>();
    },
  });
  const registeredPublisher = createEventPublisher({
    registrations: [subscriber],
    diagnostics: { log() {}, count() {} },
  });
  registeredPublisher.publish(fact);
  await registeredPublisher.stop();
  await publisher.stop();
});

it("validates once and isolates nested producer and sibling payloads with one envelope", async () => {
  const nestedSchema = schema
    .extend({ data: z.object({ nested: z.object({ value: z.string() }) }) })
    .strict();
  const parse = vi.fn((input: unknown) => nestedSchema.parse(input));
  const nestedDefinition = { type: "test.created", version: 1, parse };
  const source = { ...fact, data: { nested: { value: "published" } } };
  const waiting = deferred();
  const seen: unknown[] = [];
  const metadata = vi.fn(() => ({ ...envelope }));
  const events = createEventPublisher({
    registrations: [
      eventRegistration(
        nestedDefinition,
        {
          id: "mutating",
          enqueue(event) {
            expect(Object.isFrozen(event)).toBe(true);
            event.data.nested.value = "first consumer";
            seen.push({ id: event.id, occurredAt: event.occurredAt });
            return waiting.promise;
          },
        },
        {
          id: "sibling",
          enqueue(event) {
            seen.push(event);
          },
        },
      ),
    ],
    diagnostics: { log() {}, count() {} },
    metadata,
  });
  events.publish(source);
  expect(parse).toHaveBeenCalledOnce();
  expect(source.data.nested.value).toBe("published");
  source.data.nested.value = "producer after publication";
  await Promise.resolve();
  expect(source.data.nested.value).toBe("producer after publication");
  expect(seen).toEqual([
    envelope,
    { ...source, data: { nested: { value: "published" } }, ...envelope },
  ]);
  expect(metadata).toHaveBeenCalledOnce();
  waiting.resolve();
  await events.stop();
});

it("routes multiple registrations for the same definition by type and version", async () => {
  const first = vi.fn();
  const second = vi.fn();
  const events = createEventPublisher({
    registrations: [
      eventRegistration(definition, { id: "first", enqueue: first }),
      eventRegistration(definition, { id: "second", enqueue: second }),
    ],
    diagnostics: { log() {}, count() {} },
    metadata: () => envelope,
  });
  events.publish({ ...fact });
  await events.stop();
  expect(first).toHaveBeenCalledWith({ ...fact, ...envelope });
  expect(second).toHaveBeenCalledWith({ ...fact, ...envelope });
});

it("preserves known unhandled facts and bounds unknown type and version diagnostics", async () => {
  const diagnostics = { log: vi.fn(), count: vi.fn() };
  const handler = vi.fn();
  const metadata = vi.fn(() => envelope);
  const events = createEventPublisher({
    registrations: [
      eventRegistration(definition),
      eventRegistration(
        { ...definition, type: "other.created", parse: () => ({ ...fact, type: "other.created" }) },
        { id: "other", enqueue: handler },
      ),
    ],
    diagnostics,
    metadata,
  });
  events.publish(fact);
  expect(diagnostics.log).not.toHaveBeenCalled();
  expect(metadata).not.toHaveBeenCalled();
  events.publish({ ...fact, version: 2 });
  events.publish({ ...fact, type: "unregistered" });
  await events.stop();
  expect(handler).not.toHaveBeenCalled();
  expect(diagnostics.log.mock.calls.map(([failure]) => [failure.eventType, failure.stage])).toEqual(
    [
      ["unknown", "validation"],
      ["unknown", "validation"],
    ],
  );
});

it.each([
  { ...fact, type: "wrong" },
  { ...fact, version: 2 },
  { ...fact, subjectId: "" },
  { ...fact, actorId: 123 },
])("contains invalid outputs from feature parsers", async (parsed) => {
  const enqueue = vi.fn();
  const diagnostics = { log: vi.fn(), count: vi.fn() };
  const events = createEventPublisher({
    registrations: [
      eventRegistration({ ...definition, parse: () => parsed } as EventDefinition, {
        id: "consumer",
        enqueue,
      }),
    ],
    diagnostics,
  });
  events.publish(fact);
  await events.stop();
  expect(enqueue).not.toHaveBeenCalled();
  expect(diagnostics.log).toHaveBeenCalledWith(
    expect.objectContaining({
      stage: "validation",
      error: new Error("Business event validation failed"),
    }),
  );
});

it("contains noncloneable payload failures without exposing values or starting consumers", async () => {
  const enqueue = vi.fn();
  const diagnostics = { log: vi.fn(), count: vi.fn() };
  const events = createEventPublisher({
    registrations: [
      eventRegistration(
        {
          ...definition,
          parse: () => ({ ...fact, data: { secret: "private-profile", callback() {} } }),
        },
        { id: "consumer", enqueue },
      ),
    ],
    diagnostics,
  });
  expect(() => events.publish(fact)).not.toThrow();
  await events.stop();
  expect(enqueue).not.toHaveBeenCalled();
  expect(diagnostics.log).toHaveBeenCalledWith(
    expect.objectContaining({
      stage: "envelope",
      error: new Error("Business event payload copy failed"),
    }),
  );
  expect(JSON.stringify(diagnostics.log.mock.calls)).not.toContain("private-profile");
});
