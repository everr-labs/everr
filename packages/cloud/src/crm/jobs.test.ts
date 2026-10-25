// @vitest-environment node
import { expect, it, vi } from "vite-plus/test";
import { createEventPublisher } from "@everr/app/server/events/publisher";
import type { EventRegistration } from "@everr/app/composition";
import { userCreated } from "@everr/app/identity/events";
import { userSyncSubscribers } from "./jobs";
import { userSyncSpec, relatedSyncSpec } from "./commands";

vi.mock("@everr/app/db/client", () => ({ db: undefined, databasePoolConfig: {} }));

function publisher(registrations: readonly EventRegistration[]) {
  const diagnostics = { log: vi.fn(), count: vi.fn() };
  return { ...createEventPublisher({ registrations, diagnostics }), diagnostics };
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
    expect.objectContaining({ userId: "u" }),
    expect.objectContaining({ maxAttempts: 8 }),
  );
});

it("registers Organization, explicit Membership, readiness and billing consumers only in cloud enabled modes", async () => {
  const { organizationSyncSubscribers } = await import("./jobs");
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
    }),
    userSyncSpec("gone-user"),
  );
});
