// @vitest-environment node
import { afterEach, expect, it, vi } from "vite-plus/test";
import { userCreated } from "@everr/app/identity/events";
import { userSyncSubscribers, userSyncSpec } from "./jobs";
import { contactPermitGap } from "./worker";

vi.mock("@everr/app/db/client", () => ({ db: undefined, databasePoolConfig: {} }));
afterEach(() => vi.useRealTimers());

it("registers cloud lifecycle consumers while disabled mode remains inert", () => {
  expect(userSyncSubscribers("disabled")).toEqual([]);
  const consumers = userSyncSubscribers("paused");
  expect(consumers.map((consumer) => consumer.definition.type)).toEqual([
    "identity.user.created",
    "identity.user.updated",
    "identity.email.verified",
    "identity.user.deleted",
  ]);
  expect(
    new Set(Array.from({ length: 1000 }, (_, id) => userSyncSpec(String(id)).queueName)).size,
  ).toBeLessThanOrEqual(64);
  expect(userSyncSpec("same")).toEqual(userSyncSpec("same"));
});

it("rejects malformed subject IDs and allows enqueue rejection to reach the publisher's failure boundary", async () => {
  const enqueue = vi.fn(async () => {
    throw new Error("enqueue unavailable");
  });
  const [consumer] = userSyncSubscribers("configured", enqueue);
  const event = { ...userCreated("u", false), id: "e", occurredAt: new Date().toISOString() };
  await expect(consumer.enqueue({ ...event, subjectId: "other" })).rejects.toThrow(
    "Invalid CRM user subject",
  );
  expect(enqueue).not.toHaveBeenCalled();
  await expect(consumer.enqueue(event)).rejects.toThrow("enqueue unavailable");
  expect(enqueue).toHaveBeenCalledWith(
    "crm/sync-user",
    expect.objectContaining({ userId: "u", failures: 0 }),
    expect.objectContaining({ maxAttempts: 8 }),
  );
});

it("waits only for the normal contact permit gap and honors cancellation", async () => {
  vi.useFakeTimers();
  const budget = {
    acquire: vi
      .fn()
      .mockResolvedValueOnce({ allowed: false, retryAt: new Date(Date.now() + 100) })
      .mockResolvedValue({ allowed: true }),
    cooldown: vi.fn(),
  };
  const controller = new AbortController();
  const pending = contactPermitGap(budget, controller.signal).acquire("contacts");
  await vi.advanceTimersByTimeAsync(101);
  expect(await pending).toEqual({ allowed: true });
  expect(budget.acquire).toHaveBeenCalledTimes(2);
  const long = { allowed: false, retryAt: new Date(Date.now() + 60_000) };
  budget.acquire.mockResolvedValue(long);
  expect(await contactPermitGap(budget, controller.signal).acquire("contacts")).toBe(long);
  budget.acquire.mockResolvedValue({ allowed: false, retryAt: new Date(Date.now() + 100) });
  const cancelled = contactPermitGap(budget, controller.signal).acquire("contacts");
  controller.abort();
  await expect(cancelled).rejects.toThrow();
});

it("registers Organization, explicit Membership, readiness and billing consumers only in cloud enabled modes", async () => {
  const { organizationSyncSubscribers, relatedSyncSpec } = await import("./jobs");
  expect(organizationSyncSubscribers("disabled")).toEqual([]);
  const enqueue = vi.fn(async () => undefined);
  const consumers = organizationSyncSubscribers("paused", enqueue);
  expect(consumers.map((consumer) => consumer.definition.type)).toEqual([
    "organization.created",
    "organization.updated",
    "organization.deleted",
    "membership.added",
    "membership.updated",
    "membership.removed",
    "organization.provisioned",
    "billing.subscription.changed",
    "organization.plan.changed",
    "telemetry.first_queryable",
    "organization.activated",
  ]);
  const removed = consumers.find((consumer) => consumer.definition.type === "membership.removed")!;
  await removed.enqueue({
    id: "event",
    type: "membership.removed",
    version: 1,
    subjectId: "row-old",
    data: { membershipId: "row-old", organizationId: "org", userId: "user" },
    occurredAt: new Date().toISOString(),
  });
  expect(enqueue).toHaveBeenCalledWith(
    "crm/sync-membership",
    expect.objectContaining({ userId: "user", organizationId: "org" }),
    expect.anything(),
  );
  expect(
    new Set(Array.from({ length: 1000 }, (_, id) => relatedSyncSpec(String(id)).queueName)).size,
  ).toBeLessThanOrEqual(64);
});

it("admits deletion facts using only retained source identities in paused mode", async () => {
  const { organizationSyncSubscribers } = await import("./jobs");
  const enqueue = vi.fn(async () => undefined);
  const userDeleted = userSyncSubscribers("paused", enqueue).find(
    (consumer) => consumer.definition.type === "identity.user.deleted",
  );
  const organizationDeleted = organizationSyncSubscribers("paused", enqueue).find(
    (consumer) => consumer.definition.type === "organization.deleted",
  );
  if (!userDeleted || !organizationDeleted) throw new Error("Missing deletion subscribers");
  const common = { id: "delete-event", version: 1, occurredAt: new Date().toISOString() };
  await userDeleted.enqueue({
    ...common,
    type: "identity.user.deleted",
    subjectId: "gone-user",
    data: { userId: "gone-user" },
  });
  await organizationDeleted.enqueue({
    ...common,
    type: "organization.deleted",
    subjectId: "gone-org",
    data: { organizationId: "gone-org" },
  });
  expect(enqueue).toHaveBeenCalledTimes(2);
  expect(enqueue).toHaveBeenNthCalledWith(
    1,
    "crm/sync-user",
    expect.objectContaining({
      userId: "gone-user",
      eventType: "identity.user.deleted",
      failures: 0,
    }),
    userSyncSpec("gone-user"),
  );
});
