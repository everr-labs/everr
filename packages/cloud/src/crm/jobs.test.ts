// @vitest-environment node
import { expect, it, vi } from "vite-plus/test";
import { createEventPublisher } from "@everr/app/server/events/publisher";
import type { EventRegistration } from "@everr/app/composition";
import { userCreated } from "@everr/app/identity/events";
import {
  userSyncSubscribers,
  organizationSyncSubscribers,
  membershipSyncSubscribers,
} from "./jobs";
import { userSyncSpec, relatedSyncSpec } from "./commands";

vi.mock("@everr/app/db/client", () => ({ db: undefined, databasePoolConfig: {} }));

function publisher(registrations: readonly EventRegistration[]) {
  const diagnostics = vi.fn();
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
  expect(events.diagnostics.mock.calls.map(([failure]) => failure.error.message)).toEqual([
    "Invalid CRM user subject.",
    "enqueue unavailable",
  ]);
  expect(enqueue).toHaveBeenCalledWith(
    "crm/sync-user",
    expect.objectContaining({ userId: "u" }),
    expect.objectContaining({ maxAttempts: 8 }),
  );
});

it.each(["configured", "paused"] as const)(
  "routes Organization and Membership facts through their own consumers in %s mode",
  async (mode) => {
    expect(organizationSyncSubscribers("disabled")).toEqual([]);
    expect(membershipSyncSubscribers("disabled")).toEqual([]);
    const enqueue = vi.fn(async () => undefined);
    const organizations = organizationSyncSubscribers(mode, enqueue);
    const memberships = membershipSyncSubscribers(mode, enqueue);
    expect(organizations.map((consumer) => consumer.definition.type).sort()).toEqual(
      [
        "organization.created",
        "organization.updated",
        "organization.deleted",
        "organization.provisioned",
        "billing.subscription.changed",
        "organization.plan.changed",
        "telemetry.first_queryable",
        "organization.activated",
      ].sort(),
    );
    expect(memberships.map((consumer) => consumer.definition.type).sort()).toEqual(
      ["membership.added", "membership.updated", "membership.removed"].sort(),
    );
    for (const consumer of [...organizations, ...memberships])
      expect(consumer.subscribers[0].id).toBe(`crm.brevo.${consumer.definition.type}`);
    const events = publisher([...organizations, ...memberships]);
    events.publish({
      type: "organization.updated",
      version: 1,
      subjectId: "org",
      data: { organizationId: "org" },
    });
    events.publish({
      type: "membership.removed",
      version: 1,
      subjectId: "row-old",
      data: { membershipId: "row-old", organizationId: "org", userId: "user" },
    });
    await events.stop();
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(
      "crm/sync-organization",
      expect.objectContaining({
        kind: "organization",
        organizationId: "org",
        eventType: "organization.updated",
      }),
      relatedSyncSpec("org"),
    );
    expect(enqueue).toHaveBeenCalledWith(
      "crm/sync-membership",
      expect.objectContaining({
        kind: "membership",
        userId: "user",
        organizationId: "org",
        eventType: "membership.removed",
      }),
      relatedSyncSpec("org", "user"),
    );
    expect(
      new Set(Array.from({ length: 1000 }, (_, id) => relatedSyncSpec(String(id)).queueName)).size,
    ).toBeLessThanOrEqual(64);
  },
);

it("rejects mismatched Organization and Membership subjects before enqueue", async () => {
  const enqueue = vi.fn(async () => undefined);
  const events = publisher([
    ...organizationSyncSubscribers("configured", enqueue),
    ...membershipSyncSubscribers("configured", enqueue),
  ]);
  events.publish({
    type: "organization.updated",
    version: 1,
    subjectId: "other",
    data: { organizationId: "org" },
  });
  events.publish({
    type: "membership.updated",
    version: 1,
    subjectId: "other",
    data: { membershipId: "row", organizationId: "org", userId: "user" },
  });
  await events.stop();
  expect(enqueue).not.toHaveBeenCalled();
  expect(events.diagnostics).toHaveBeenCalledTimes(2);
});

it("admits deletion facts using only retained source identities in paused mode", async () => {
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
