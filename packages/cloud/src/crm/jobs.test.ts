// @vitest-environment node
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createBusinessEventPublisher } from "@everr/app/server/business-events/publisher";
import type { BusinessEventRegistration } from "@everr/app/composition";
import { userCreated } from "@everr/app/identity/events";
import { userSyncSubscribers, userSyncSpec } from "./jobs";
import { contactPermitGap } from "./worker";

vi.mock("@everr/app/db/client", () => ({ db: undefined, databasePoolConfig: {} }));
afterEach(() => vi.useRealTimers());

function publisher(registrations: readonly BusinessEventRegistration[]) {
  const diagnostics = { log: vi.fn(), count: vi.fn() };
  return { ...createBusinessEventPublisher({ registrations, diagnostics }), diagnostics };
}

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

it("contains malformed subjects and enqueue failures at the real publication seam", async () => {
  const enqueue = vi.fn(async () => {
    throw new Error("enqueue unavailable");
  });
  const events = publisher(userSyncSubscribers("configured", enqueue));
  events.publish({ ...userCreated("u", false), subjectId: "other" });
  events.publish(userCreated("u", false));
  await events.stop();
  expect(enqueue).toHaveBeenCalledOnce();
  expect(events.diagnostics.log.mock.calls.map(([failure]) => failure.error.message)).toEqual([
    "Invalid CRM user subject.",
    "enqueue unavailable",
  ]);
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
  const events = publisher(consumers);
  events.publish({
    type: "membership.removed",
    version: 1,
    subjectId: "row-old",
    data: { membershipId: "row-old", organizationId: "org", userId: "user" },
  });
  await events.stop();
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
  const events = publisher([
    ...userSyncSubscribers("paused", enqueue),
    ...organizationSyncSubscribers("paused", enqueue),
  ]);
  events.publish({
    type: "identity.user.deleted",
    version: 1,
    subjectId: "gone-user",
    data: { userId: "gone-user" },
  });
  events.publish({
    type: "organization.deleted",
    version: 1,
    subjectId: "gone-org",
    data: { organizationId: "gone-org" },
  });
  await events.stop();
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
