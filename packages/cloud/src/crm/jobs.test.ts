import { serverLogger } from "@everr/app/telemetry/logger";
// @vitest-environment node
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createEventPublisher } from "@everr/app/server/events/publisher";
import { userCreated } from "@everr/app/identity/events";
import { crmEventRoutes } from "./jobs";
import { userSyncSpec, relatedSyncSpec } from "./commands";

vi.mock("@everr/app/db/client", () => ({ db: undefined, databasePoolConfig: {} }));

afterEach(() => vi.restoreAllMocks());

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
  expect(
    crmEventRoutes("configured")
      .map(({ definition }) => definition.type)
      .sort(),
  ).toEqual([...userTypes, ...organizationTypes, ...membershipTypes].sort());
});

it.each([...userTypes, ...organizationTypes, ...membershipTypes])(
  "directly admits the correct Graphile job for %s",
  async (type) => {
    const enqueue = vi.fn(async () => {});
    const diagnostics = vi.spyOn(serverLogger, "error").mockImplementation(() => {});
    const events = createEventPublisher({ routes: crmEventRoutes("configured"), enqueue });
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

it("does not create a CRM job for provisioning readiness", async () => {
  const enqueue = vi.fn(async () => {});
  await createEventPublisher({ routes: crmEventRoutes("configured"), enqueue }).publish({
    type: "organization.provisioned",
    version: 1,
    subjectId: "o",
    data: { organizationId: "o" },
  });
  expect(enqueue).not.toHaveBeenCalled();
});

it("contains mismatched subjects and Graphile failures without changing committed source results", async () => {
  const diagnostics = vi.spyOn(serverLogger, "error").mockImplementation(() => {});
  const enqueue = vi.fn(async () => {
    throw new Error("enqueue unavailable");
  });
  const events = createEventPublisher({
    routes: crmEventRoutes("configured"),
    enqueue,
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
  expect(diagnostics.mock.calls.map(([, attributes]) => attributes?.["exception.message"])).toEqual(
    [
      "Business event job construction failed",
      "Business event job construction failed",
      "Business event job construction failed",
      "enqueue unavailable",
    ],
  );
  expect(
    diagnostics.mock.calls.map(
      ([, attributes]) => attributes?.["everr.business_event.failure_stage"],
    ),
  ).toEqual(["job", "job", "job", "enqueue"]);
  expect(
    diagnostics.mock.calls.map(([, attributes]) => attributes?.["everr.business_event.type"]),
  ).toEqual([
    "identity.user.created",
    "organization.updated",
    "membership.removed",
    "identity.user.created",
  ]);
});

it("preserves stable job keys and one serialized Graphile queue", () => {
  for (const spec of [userSyncSpec, relatedSyncSpec]) {
    expect(spec("same")).toEqual(spec("same"));
    expect(new Set(Array.from({ length: 1000 }, (_, id) => spec(String(id)).queueName)).size).toBe(
      1,
    );
  }
  expect(relatedSyncSpec("o", "u").jobKey).not.toBe(relatedSyncSpec("o", "other").jobKey);
});

it("retains previous Membership endpoints and does not coalesce distinct moves", async () => {
  const enqueue = vi.fn(async () => {});
  const publisher = createEventPublisher({ routes: crmEventRoutes("configured"), enqueue });
  const fact = {
    type: "membership.updated",
    version: 1,
    subjectId: "m",
    data: {
      membershipId: "m",
      organizationId: "target",
      userId: "u",
      previous: { organizationId: "old", userId: "old-user" },
    },
  };
  await publisher.publish(fact);
  await publisher.publish({
    ...fact,
    data: { ...fact.data, previous: { organizationId: "other", userId: "u" } },
  });
  expect(enqueue).toHaveBeenCalledTimes(2);
  for (const [index, call] of enqueue.mock.calls.entries()) {
    expect(call).toEqual([
      "crm/sync-membership",
      expect.objectContaining({
        organizationId: "target",
        userId: "u",
        previous: index === 0 ? fact.data.previous : { organizationId: "other", userId: "u" },
      }),
      expect.objectContaining({
        queueName: "crm-brevo",
        maxAttempts: 8,
        jobKey: expect.stringMatching(/^crm-membership-change:/),
      }),
    ]);
  }
  expect((enqueue.mock.calls[0] as unknown[])[2]).not.toEqual(
    (enqueue.mock.calls[1] as unknown[])[2],
  );
});
