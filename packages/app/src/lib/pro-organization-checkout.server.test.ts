// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import type { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

const mocks = vi.hoisted(() => ({
  team: vi.fn(),
  person: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  customer: vi.fn(),
  subscription: vi.fn(),
  link: vi.fn(),
  provision: vi.fn(),
  createOrg: vi.fn(),
  locks: new Set<string>(),
}));
vi.mock("@/db/client", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  const client = new PGlite();
  return { db: drizzle(client, { schema }) };
});
vi.mock("@/env", () => ({
  env: { BETTER_AUTH_URL: "https://app.example", POLAR_PRO_PRODUCT_ID: "pro" },
}));
vi.mock("@/lib/polar-team.server", () => ({
  ensurePolarTeamCustomer: mocks.team,
  readBillingPerson: mocks.person,
}));
vi.mock("@/lib/polar.server", () => ({
  polarClient: {
    checkouts: { list: mocks.list, create: mocks.create, get: mocks.get },
    customers: { get: mocks.customer },
    subscriptions: { get: mocks.subscription },
  },
  linkPolarCustomerToOrg: mocks.link,
  getPolarCustomerForOrg: vi.fn(),
}));
vi.mock("@/lib/auth.server", () => ({
  auth: { api: { createOrganization: mocks.createOrg } },
}));
vi.mock("@/lib/clickhouse", () => ({
  provisionSqlApiOrgUser: mocks.provision,
}));
vi.mock("@/telemetry/logger", () => ({ serverLogger: { warn: vi.fn() } }));
vi.mock("@/lib/checkout-lock.server", () => ({
  organizationCheckoutLockKey: (owner: string, name: string) =>
    JSON.stringify([owner, name]),
  withCheckoutLock: async (key: string, run: () => Promise<unknown>) => {
    if (mocks.locks.has(key))
      throw new Error("Checkout is being processed. Please try again.");
    mocks.locks.add(key);
    try {
      return await run();
    } finally {
      mocks.locks.delete(key);
    }
  },
}));

import { db as applicationDb } from "@/db/client";
import { beforeCreateCheckoutOrganization } from "./organization-creation-context.server";
import {
  checkoutIntentMetadata,
  startProOrganizationCheckout,
} from "./pro-organization-checkout.server";
import { createProOrganizationFinalizer } from "./pro-organization-finalization.server";

const { finalizeProOrganizationCheckout, syncSubscription } =
  createProOrganizationFinalizer(mocks.createOrg);

// Real PostgreSQL semantics for partial indexes, durable intents and upserts.
const db = applicationDb as unknown as ReturnType<
  typeof drizzle<typeof schema>
>;
const client = db.$client as PGlite;
await client.exec(`
  CREATE TABLE "user" (id text PRIMARY KEY);
  CREATE TABLE organization (id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, logo text, metadata text, created_at timestamp NOT NULL, plan text NOT NULL DEFAULT 'hobby');
  CREATE TABLE member (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id), user_id text NOT NULL REFERENCES "user"(id), role text NOT NULL, created_at timestamp NOT NULL);
  CREATE TABLE pro_organization_checkout (org_id text PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"(id), organization_name text NOT NULL, organization_slug text NOT NULL UNIQUE, checkout_id text, created_at timestamp NOT NULL DEFAULT now(), completed_at timestamp);
  CREATE UNIQUE INDEX pro_organization_checkout_pending_owner_name_uidx ON pro_organization_checkout(owner_id, organization_name) WHERE completed_at IS NULL;
  CREATE TABLE org_subscription (org_id text PRIMARY KEY REFERENCES organization(id), polar_subscription_id text NOT NULL, polar_product_id text NOT NULL, status text NOT NULL, current_period_end timestamp, cancel_at_period_end boolean NOT NULL DEFAULT false, polar_modified_at timestamp NOT NULL, updated_at timestamp NOT NULL DEFAULT now());
`);
afterAll(() => client.close());
function pages(items: unknown[][]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const batch of items) yield { result: { items: batch } };
    },
  };
}
const active = {
  id: "sub",
  customerId: "customer",
  productId: "pro",
  status: "active",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  modifiedAt: null,
  createdAt: new Date("2026-09-10T12:00:00Z"),
};
const openCheckout = {
  customerId: "customer",
  id: "checkout",
  status: "open",
  url: "https://polar.example/checkout",
  expiresAt: new Date("2099-01-01"),
  productId: "pro",
};
async function intent() {
  return (await db.select().from(schema.proOrganizationCheckout))[0];
}
async function prepare() {
  await startProOrganizationCheckout("owner", "Acme");
  const row = await intent();
  const metadata = checkoutIntentMetadata(row);
  mocks.customer.mockResolvedValue({ id: "customer", externalId: row.orgId });
  return { row, metadata };
}
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.team.mockResolvedValue({ id: "customer" });
  mocks.person.mockResolvedValue({
    id: "owner",
    email: "owner@example.com",
    name: "Owner",
  });
  mocks.locks.clear();
  await client.exec(
    `TRUNCATE org_subscription, member, organization, pro_organization_checkout, "user"; INSERT INTO "user" (id) VALUES ('owner'), ('other');`,
  );
  mocks.list.mockImplementation(() => Promise.resolve(pages([[]])));
  mocks.create.mockImplementation(async (input) => ({
    ...openCheckout,
    externalCustomerId: input.externalCustomerId,
    metadata: input.metadata,
  }));
  mocks.subscription.mockResolvedValue(active);
  mocks.get.mockResolvedValue({ ...openCheckout, status: "expired" });
  mocks.createOrg.mockImplementation(async ({ body }) => {
    const context = await beforeCreateCheckoutOrganization({
      organization: body,
      user: { id: body.userId },
    });
    const id = context?.data.id ?? "legacy-org";
    const [org] = await db
      .insert(schema.organization)
      .values({
        id,
        name: body.name,
        slug: body.slug,
        plan: "pro",
        createdAt: new Date(),
      })
      .returning();
    await db.insert(schema.member).values({
      id: `member-${id}`,
      organizationId: id,
      userId: body.userId,
      role: "owner",
      createdAt: new Date(),
    });
    return org;
  });
});

describe("durable Pro checkouts", () => {
  it("reserves an ID before contacting Polar, without creating an org or sending email", async () => {
    mocks.create.mockImplementationOnce(async (input) => {
      expect(await intent()).toMatchObject({
        orgId: input.externalCustomerId,
        ownerId: "owner",
      });
      expect(await db.select().from(schema.organization)).toEqual([]);
      expect(input).not.toHaveProperty("customerEmail");
      expect(input.customerId).toBe("customer");
      return {
        ...openCheckout,
        metadata: input.metadata,
        externalCustomerId: input.externalCustomerId,
      };
    });
    await expect(
      startProOrganizationCheckout("owner", "Acme"),
    ).resolves.toEqual({ kind: "checkout", url: openCheckout.url });
    expect((await intent()).checkoutId).toBe("checkout");
  });
  it.each([
    "open",
    "confirmed",
    "succeeded",
  ])("resumes a %s checkout on a later page", async (status) => {
    const { row, metadata } = await prepare();
    mocks.list.mockResolvedValueOnce(
      pages([
        [{ ...openCheckout, externalCustomerId: "unrelated" }],
        [{ ...openCheckout, externalCustomerId: row.orgId, metadata, status }],
      ]),
    );
    const result = await startProOrganizationCheckout("owner", "Acme");
    expect(result.url).toBe(
      status === "open"
        ? openCheckout.url
        : "https://app.example/organizations/checkout/success?checkout_id=checkout",
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("reopens a known checkout without listing every session", async () => {
    const { row, metadata } = await prepare();
    mocks.get.mockResolvedValueOnce({
      ...openCheckout,
      externalCustomerId: row.orgId,
      metadata,
    });
    await startProOrganizationCheckout("owner", "Acme");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("recovers a lost creation response without another checkout", async () => {
    let saved: unknown;
    mocks.create.mockImplementationOnce(async (input) => {
      saved = {
        ...openCheckout,
        metadata: input.metadata,
        externalCustomerId: input.externalCustomerId,
      };
      throw new Error("connection lost");
    });
    await expect(startProOrganizationCheckout("owner", "Acme")).rejects.toThrow(
      "connection lost",
    );
    expect((await intent()).checkoutId).toBeNull();
    mocks.list.mockResolvedValueOnce(pages([[saved]]));
    await expect(
      startProOrganizationCheckout("owner", "Acme"),
    ).resolves.toMatchObject({ url: openCheckout.url });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("replaces an expired checkout while retaining the reserved ID", async () => {
    const { row, metadata } = await prepare();
    mocks.list.mockResolvedValueOnce(
      pages([
        [
          {
            ...openCheckout,
            metadata,
            externalCustomerId: row.orgId,
            expiresAt: new Date(0),
          },
        ],
      ]),
    );
    await startProOrganizationCheckout("owner", "Acme");
    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ externalCustomerId: row.orgId }),
    );
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(await db.select().from(schema.proOrganizationCheckout)).toHaveLength(
      1,
    );
  });
  it("fails closed when reconciliation is unavailable", async () => {
    await prepare();
    mocks.list.mockRejectedValueOnce(new Error("offline"));
    await expect(startProOrganizationCheckout("owner", "Acme")).rejects.toThrow(
      "offline",
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(await intent()).toBeDefined();
  });
  it("serializes concurrent submissions and enforces the pending uniqueness constraint", async () => {
    const results = await Promise.allSettled([
      startProOrganizationCheckout("owner", "Acme"),
      startProOrganizationCheckout("owner", "Acme"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const row = await intent();
    await expect(
      db
        .insert(schema.proOrganizationCheckout)
        .values({ ...row, orgId: "duplicate", organizationSlug: "different" }),
    ).rejects.toThrow();
  });
});

describe("checkout finalization", () => {
  it("creates the reserved org from a webhook without a browser and tolerates duplicates", async () => {
    const { row, metadata } = await prepare();
    const event = {
      data: {
        ...active,
        metadata,
        customer: { id: "customer", externalId: row.orgId },
      },
    };
    await syncSubscription(event);
    await syncSubscription(event);
    await finalizeProOrganizationCheckout({
      metadata,
      customerId: "customer",
      subscription: active,
    });
    expect(await db.select().from(schema.organization)).toEqual([
      expect.objectContaining({ id: row.orgId, plan: "pro" }),
    ]);
    expect(await db.select().from(schema.member)).toHaveLength(1);
    expect(await db.select().from(schema.orgSubscription)).toHaveLength(1);
    expect(mocks.createOrg).toHaveBeenCalledTimes(1);
    expect(mocks.link).not.toHaveBeenCalled();
    expect((await intent()).completedAt).not.toBeNull();
  });
  it("serializes the callback against a webhook and allows a retry", async () => {
    const { row, metadata } = await prepare();
    const input = { metadata, customerId: "customer", subscription: active };
    await Promise.allSettled([
      finalizeProOrganizationCheckout(input),
      syncSubscription({
        data: {
          ...active,
          metadata,
          customer: { id: "customer", externalId: row.orgId },
        },
      }),
    ]);
    await finalizeProOrganizationCheckout(input);
    expect(mocks.createOrg).toHaveBeenCalledTimes(1);
    expect(await db.select().from(schema.member)).toHaveLength(1);
  });
  it("repairs a failure after org insertion but before owner creation", async () => {
    const { row, metadata } = await prepare();
    mocks.createOrg.mockImplementationOnce(async () => {
      await db.insert(schema.organization).values({
        id: row.orgId,
        name: row.organizationName,
        slug: row.organizationSlug,
        plan: "pro",
        createdAt: new Date(),
      });
      throw new Error("member insert failed");
    });
    const input = { metadata, customerId: "customer", subscription: active };
    await expect(finalizeProOrganizationCheckout(input)).rejects.toThrow(
      "member insert failed",
    );
    await finalizeProOrganizationCheckout(input);
    expect(await db.select().from(schema.member)).toEqual([
      expect.objectContaining({ userId: "owner", role: "owner" }),
    ]);
    expect(mocks.provision).toHaveBeenCalledWith(row.orgId);
  });
  it("retries a provisioning failure without creating another org", async () => {
    const { metadata } = await prepare();
    mocks.provision.mockRejectedValueOnce(new Error("provision failed"));
    const input = { metadata, customerId: "customer", subscription: active };
    await expect(finalizeProOrganizationCheckout(input)).rejects.toThrow(
      "provision failed",
    );
    await finalizeProOrganizationCheckout(input);
    expect(mocks.createOrg).toHaveBeenCalledTimes(1);
    expect((await intent()).completedAt).not.toBeNull();
  });
  it("does not resurrect an org deleted after completion", async () => {
    const { row, metadata } = await prepare();
    const input = { metadata, customerId: "customer", subscription: active };
    await finalizeProOrganizationCheckout(input);
    await client.exec(
      `DELETE FROM org_subscription; DELETE FROM member; DELETE FROM organization;`,
    );
    await expect(finalizeProOrganizationCheckout(input)).rejects.toThrow(
      "no longer exists",
    );
    expect((await intent()).orgId).toBe(row.orgId);
  });
  it("rejects a customer reused by Polar through an email belonging to another org", async () => {
    const { metadata } = await prepare();
    mocks.customer.mockResolvedValue({
      id: "customer",
      externalId: "another-org",
    });
    await expect(
      finalizeProOrganizationCheckout({
        metadata,
        customerId: "customer",
        subscription: active,
      }),
    ).rejects.toThrow("does not match");
    expect(mocks.createOrg).not.toHaveBeenCalled();
    expect(await db.select().from(schema.orgSubscription)).toEqual([]);
  });
  it("rejects tampered ownership and mismatching products", async () => {
    const { metadata } = await prepare();
    await expect(
      finalizeProOrganizationCheckout({
        metadata: { ...metadata, everrOwnerId: "other" },
        customerId: "customer",
        subscription: active,
      }),
    ).rejects.toThrow("does not match");
    await expect(
      finalizeProOrganizationCheckout({
        metadata,
        customerId: "customer",
        subscription: { ...active, productId: "wrong" },
      }),
    ).rejects.toThrow();
    expect(mocks.createOrg).not.toHaveBeenCalled();
  });
  it("ignores an old active webhook when the subscription is no longer active", async () => {
    const { row, metadata } = await prepare();
    mocks.subscription.mockResolvedValueOnce({ ...active, status: "canceled" });
    await syncSubscription({
      data: {
        ...active,
        metadata,
        customer: { id: "customer", externalId: row.orgId },
      },
    });
    expect(mocks.createOrg).not.toHaveBeenCalled();
    expect(await db.select().from(schema.orgSubscription)).toEqual([]);
  });
  it("preserves newer subscription state when an old active webhook is repeated", async () => {
    const { row, metadata } = await prepare();
    const event = {
      data: {
        ...active,
        metadata,
        customer: { id: "customer", externalId: row.orgId },
      },
    };
    await syncSubscription(event);
    await syncSubscription({
      data: {
        ...event.data,
        status: "canceled",
        modifiedAt: new Date("2026-09-11"),
      },
    });
    await syncSubscription(event);
    expect((await db.select().from(schema.orgSubscription))[0].status).toBe(
      "canceled",
    );
  });
  it("allows a new organization of the same name after completion", async () => {
    const { metadata } = await prepare();
    await finalizeProOrganizationCheckout({
      metadata,
      customerId: "customer",
      subscription: active,
    });
    await startProOrganizationCheckout("owner", "Acme");
    expect(await db.select().from(schema.proOrganizationCheckout)).toHaveLength(
      2,
    );
  });
  it("supports legacy version 1 checkouts and links their customer only after creation", async () => {
    const metadata = {
      everrPurpose: "create_pro_organization",
      everrSchemaVersion: 1,
      everrOwnerId: "owner",
      everrOrganizationName: "Acme",
      everrOrganizationSlug: "legacy",
    } as const;
    mocks.customer.mockResolvedValue({ id: "customer", externalId: null });
    const result = await finalizeProOrganizationCheckout({
      metadata,
      customerId: "customer",
      subscription: active,
    });
    expect(result.organization.id).toBe("legacy-org");
    expect(mocks.link).toHaveBeenCalledWith({
      customerId: "customer",
      orgId: "legacy-org",
    });
  });
  it("rejects upgrade webhooks whose customer belongs to another org", async () => {
    await expect(
      syncSubscription({
        data: {
          ...active,
          metadata: { orgId: "target" },
          customer: { id: "customer", externalId: "wrong" },
        },
      }),
    ).rejects.toThrow("does not match");
    expect(await db.select().from(schema.orgSubscription)).toEqual([]);
  });
});

it("replaces a legacy customerless open checkout with a customer-bound session", async () => {
  const { row, metadata } = await prepare();
  mocks.get.mockResolvedValue({
    ...openCheckout,
    customerId: null,
    externalCustomerId: row.orgId,
    metadata,
  });
  mocks.create.mockClear();
  await startProOrganizationCheckout("owner", "Acme");
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      customerId: "customer",
      externalCustomerId: row.orgId,
    }),
  );
});
it("does not resume an open checkout attached to a different customer", async () => {
  const { row, metadata } = await prepare();
  mocks.get.mockResolvedValue({
    ...openCheckout,
    customerId: "foreign",
    externalCustomerId: row.orgId,
    metadata,
  });
  mocks.create.mockClear();
  await expect(startProOrganizationCheckout("owner", "Acme")).rejects.toThrow(
    "customer does not match",
  );
  expect(mocks.create).not.toHaveBeenCalled();
});
