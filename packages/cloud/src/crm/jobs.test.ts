// @vitest-environment node
import { expect, it, vi } from "vite-plus/test";
import { createEventPublisher } from "@everr/app/server/events/publisher";
import { userCreated } from "@everr/app/identity/events";
import { crmEventRoutes } from "./jobs";
import { userSyncSpec, relatedSyncSpec } from "./commands";

vi.mock("@everr/app/db/client", () => ({ db: undefined, databasePoolConfig: {} }));

const userTypes = [
  "identity.user.created",
  "identity.user.updated",
  "identity.email.verified",
  "identity.user.deleted",
];
const organizationTypes = [
  "organization.created",
  "organization.updated",
  "organization.deleted",
  "billing.subscription.changed",
  "organization.plan.changed",
];
const membershipTypes = ["membership.added", "membership.updated", "membership.removed"];

it("selects exactly the 12 CRM triggers and leaves disabled mode inert", () => {
  expect(crmEventRoutes("disabled")).toEqual([]);
  for (const mode of ["configured", "paused"] as const) {
    expect(
      crmEventRoutes(mode)
        .map(({ definition }) => definition.type)
        .sort(),
    ).toEqual([...userTypes, ...organizationTypes, ...membershipTypes].sort());
  }
});

it.each([...userTypes, ...organizationTypes, ...membershipTypes])(
  "directly admits the correct Graphile job for %s",
  async (type) => {
    const enqueue = vi.fn(async () => {});
    const diagnostics = vi.fn();
    const events = createEventPublisher({ routes: crmEventRoutes("paused"), enqueue, diagnostics });
    const isUser = userTypes.includes(type);
    const isMember = membershipTypes.includes(type);
    const data = isUser
      ? { userId: "u", ...(type === "identity.user.created" ? { emailVerified: false } : {}) }
      : isMember
        ? { membershipId: "m", organizationId: "o", userId: "u" }
        : {
            organizationId: "o",
            ...(type === "billing.subscription.changed" ? { subscriptionId: "s" } : {}),
            ...(type === "organization.plan.changed" ? { previousPlan: "hobby", plan: "pro" } : {}),
          };
    await events.publish({
      type,
      version: 1,
      subjectId: isUser ? "u" : isMember ? "m" : "o",
      data,
    });
    expect(diagnostics).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(
      isUser ? "crm/sync-user" : isMember ? "crm/sync-membership" : "crm/sync-organization",
      {
        version: 1,
        eventId: expect.any(String),
        eventType: type,
        occurredAt: expect.any(String),
        ...(isUser
          ? { userId: "u" }
          : isMember
            ? { kind: "membership", organizationId: "o", userId: "u" }
            : { kind: "organization", organizationId: "o" }),
      },
      isUser ? userSyncSpec("u") : relatedSyncSpec("o", isMember ? "u" : undefined),
    );
  },
);

it.each(["organization.provisioned", "telemetry.first_queryable", "organization.activated"])(
  "does not create a CRM job for %s",
  async (type) => {
    const enqueue = vi.fn(async () => {});
    await createEventPublisher({ routes: crmEventRoutes("configured"), enqueue }).publish({
      type,
      version: 1,
      subjectId: "o",
      data: { organizationId: "o" },
    });
    expect(enqueue).not.toHaveBeenCalled();
  },
);

it("contains mismatched subjects and Graphile failures without changing committed source results", async () => {
  const diagnostics = vi.fn();
  const enqueue = vi.fn(async () => {
    throw new Error("enqueue unavailable");
  });
  const events = createEventPublisher({
    routes: crmEventRoutes("configured"),
    enqueue,
    diagnostics,
  });
  await events.publish({ ...userCreated("u", false), subjectId: "other" });
  await events.publish({
    type: "organization.updated",
    version: 1,
    subjectId: "other",
    data: { organizationId: "o" },
  });
  await events.publish({
    type: "membership.removed",
    version: 1,
    subjectId: "other",
    data: { membershipId: "m", organizationId: "o", userId: "u" },
  });
  await expect(events.publish(userCreated("u", false))).resolves.toBeUndefined();
  expect(enqueue).toHaveBeenCalledOnce();
  expect(diagnostics.mock.calls.map(([failure]) => failure.error.message)).toEqual([
    "Invalid CRM user subject.",
    "Invalid CRM organization subject.",
    "Invalid CRM membership subject.",
    "enqueue unavailable",
  ]);
});

it("preserves stable job keys and the bounded Graphile queue partitions", () => {
  for (const spec of [userSyncSpec, relatedSyncSpec]) {
    expect(spec("same")).toEqual(spec("same"));
    expect(
      new Set(Array.from({ length: 1000 }, (_, id) => spec(String(id)).queueName)).size,
    ).toBeLessThanOrEqual(64);
  }
  expect(relatedSyncSpec("o", "u").jobKey).not.toBe(relatedSyncSpec("o", "other").jobKey);
});
