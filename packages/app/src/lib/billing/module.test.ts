// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { serverLogger } from "@/telemetry/logger";
import { billingOrganizationHooks } from "./membership-plugin.server";
import { createBillingModule } from "./module";
import { beforeCreateCheckoutOrganization } from "./organization-context.server";
import type {
  BillingMember,
  Checkout,
  Customer,
  PolarGateway,
  Subscription,
} from "./types";

vi.mock("@/env", () => ({ env: { POLAR_PRO_PRODUCT_ID: "pro" } }));
vi.mock("./server", () => ({ billing: {} }));
vi.mock("@/telemetry/logger", () => ({
  serverLogger: { info: vi.fn(), error: vi.fn() },
}));
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing test fixture");
  return value;
}
const client = new PGlite();
const database = drizzle(client, { schema });
await client.exec(`
CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE organization (id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, logo text, metadata text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE member (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id), user_id text NOT NULL REFERENCES "user"(id), role text NOT NULL, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE org_subscription (org_id text PRIMARY KEY REFERENCES organization(id), polar_subscription_id text NOT NULL, polar_product_id text NOT NULL, status text NOT NULL, current_period_end timestamp, cancel_at_period_end boolean NOT NULL DEFAULT false, polar_modified_at timestamp NOT NULL, updated_at timestamp NOT NULL DEFAULT now());
`);
await client.exec(
  await readFile(
    new URL(
      "../../../drizzle/0012_organization_customer_teams.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
afterAll(() => client.close());
const customers = new Map<string, Customer>();
const members = new Map<string, BillingMember>();
const checkouts = new Map<string, Checkout>();
const subscriptions = new Map<string, Subscription>();
const locks = new Set<string>();
const gateway = {
  findCustomer: vi.fn(
    async (orgId) =>
      [...customers.values()].find((c) => c.externalId === orgId) ?? null,
  ),
  getCustomer: vi.fn(async (id) => {
    const c = customers.get(id);
    if (!c) throw new Error("missing customer");
    return c;
  }),
  createTeam: vi.fn(async ({ orgId, owner }) => {
    const c = { id: randomUUID(), externalId: orgId, type: "team" };
    customers.set(c.id, c);
    const m: BillingMember = {
      id: randomUUID(),
      customerId: c.id,
      externalId: owner.id,
      email: owner.email,
      name: owner.name,
      role: "owner",
    };
    members.set(m.id, m);
    return c;
  }),
  members: vi.fn(async (id) =>
    [...members.values()]
      .filter((m) => m.customerId === id)
      .map((m) => ({ ...m })),
  ),
  createMember: vi.fn(async (customerId, p) => {
    const m: BillingMember = {
      id: randomUUID(),
      customerId,
      externalId: p.id,
      email: p.email,
      name: p.name,
      role: "billing_manager",
    };
    members.set(m.id, m);
    return m;
  }),
  updateMember: vi.fn(async (id, update) => {
    const m = members.get(id);
    if (!m) throw new Error("missing member");
    if (update.role === "owner")
      for (const v of members.values())
        if (v.customerId === m.customerId && v.role === "owner")
          v.role = "billing_manager";
    Object.assign(m, update);
    return m;
  }),
  deleteMember: vi.fn(async (id) => {
    members.delete(id);
  }),
  portal: vi.fn(async (customerId, memberId) => {
    if (members.get(memberId)?.customerId !== customerId)
      throw new Error("revoked");
    return `https://polar.example/portal/${memberId}`;
  }),
  checkout: vi.fn(async (id) => {
    const c = checkouts.get(id);
    if (!c) throw new Error("missing checkout");
    return c;
  }),
  checkouts: vi.fn(async (id) =>
    [...checkouts.values()].filter((c) => c.customerId === id),
  ),
  createCheckout: vi.fn(async ({ customerId, orgId, metadata }) => {
    const c: Checkout = {
      id: randomUUID(),
      customerId,
      externalCustomerId: orgId,
      status: "open",
      expiresAt: new Date(Date.now() + 60000),
      metadata,
      productId: "pro",
      subscriptionId: null,
      url: `https://polar.example/checkout/${randomUUID()}`,
    };
    checkouts.set(c.id, c);
    return c;
  }),
  subscription: vi.fn(async (id) => {
    const s = subscriptions.get(id);
    if (!s) throw new Error("missing subscription");
    return s;
  }),
  checkoutSubscription: vi.fn(
    async (c) =>
      [...subscriptions.values()].find((s) => s.checkoutId === c.id) ?? null,
  ),
  revokeSubscription: vi.fn(async () => {}),
} satisfies PolarGateway;
const provision = vi.fn(async () => {});
const billing = createBillingModule({
  db: database as unknown as Database,
  polar: gateway,
  appUrl: "https://app.example",
  provisionOrganization: provision,
  lock: async (key, run) => {
    if (locks.has(key)) throw new Error("busy");
    locks.add(key);
    try {
      return await run();
    } finally {
      locks.delete(key);
    }
  },
});
const createOrganization = vi.fn(
  async ({
    body,
  }: {
    body: { name: string; slug: string; userId: string; plan: "pro" };
  }) => {
    const context = await beforeCreateCheckoutOrganization({
      organization: body,
      user: { id: body.userId },
    });
    const id = context?.data.id;
    if (!id) throw new Error("reserved ID missing");
    await database.insert(schema.organization).values({
      id,
      name: body.name,
      slug: body.slug,
      plan: body.plan,
      createdAt: new Date(),
    });
    await database.insert(schema.member).values({
      id: randomUUID(),
      organizationId: id,
      userId: body.userId,
      role: "owner",
      createdAt: new Date(),
    });
    return { id };
  },
);
beforeEach(async () => {
  vi.clearAllMocks();
  customers.clear();
  members.clear();
  checkouts.clear();
  subscriptions.clear();
  locks.clear();
  await client.exec(
    `TRUNCATE org_subscription,pro_organization_checkout,member,organization,"user"; INSERT INTO "user" (id,name,email) VALUES ('owner','Owner','owner@example.com'),('other','Other','other@example.com'),('admin','Admin','admin@example.com'),('regular','Regular','regular@example.com'); INSERT INTO organization(id,name,slug) VALUES ('org','Acme','acme'); INSERT INTO member(id,organization_id,user_id,role) VALUES ('m1','org','owner','owner'),('m2','org','other','owner'),('m3','org','admin','admin'),('m4','org','regular','member'); UPDATE member SET created_at = created_at - interval '1 day' WHERE user_id = 'owner';`,
  );
});
async function upgrade() {
  return billing.startUpgradeCheckout("org", "admin");
}
async function paidNew() {
  await billing.startNewOrganizationCheckout("owner", "New");
  const c = [...checkouts.values()][0];
  c.status = "succeeded";
  const s: Subscription = {
    id: "sub",
    customerId: required(c.customerId),
    checkoutId: c.id,
    productId: "pro",
    status: "active",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    modifiedAt: null,
    createdAt: new Date(),
  };
  subscriptions.set(s.id, s);
  return {
    c,
    s,
    event: {
      data: {
        ...s,
        metadata: c.metadata,
        customer: { id: s.customerId, externalId: c.externalCustomerId },
      },
    },
  };
}

it("does not contact Polar for a new Hobby owner, then creates its team at the first checkout", async () => {
  await client.exec("DELETE FROM member WHERE user_id <> 'owner'");
  const hooks = billingOrganizationHooks(billing);
  await hooks.afterAddMember({
    member: { organizationId: "org", userId: "owner" },
  });
  expect(await billing.getSettings("org", "owner")).toMatchObject({
    connected: false,
    owner: null,
  });
  await expect(billing.openPortal("org", "owner")).rejects.toMatchObject({
    code: "customer_missing",
  });
  for (const operation of Object.values(gateway)) {
    expect(operation).not.toHaveBeenCalled();
  }

  await billing.startUpgradeCheckout("org", "owner");
  const [org] = await database.select().from(schema.organization);
  expect(org.plan).toBe("hobby");
  expect(org.polarCustomerId).toBe([...customers.keys()][0]);
  expect(gateway.createTeam).toHaveBeenCalledOnce();
  await billing.openPortal("org", "owner");
  expect(gateway.getCustomer).toHaveBeenCalledWith(org.polarCustomerId);
  await billing.startUpgradeCheckout("org", "owner");
  expect(gateway.createTeam).toHaveBeenCalledOnce();
  expect(gateway.createCheckout).toHaveBeenCalledOnce();
});

it("recovers a Pro organization's missing customer reference through Polar", async () => {
  await database.update(schema.organization).set({ plan: "pro" });
  const customer = await gateway.createTeam({
    orgId: "org",
    owner: { id: "owner", name: "Owner", email: "owner@example.com" },
  });
  vi.clearAllMocks();
  await billing.afterMembershipChange("org");
  expect(gateway.findCustomer).toHaveBeenCalledWith("org");
  expect(
    (await database.select().from(schema.organization))[0].polarCustomerId,
  ).toBe(customer.id);
  expect(gateway.createTeam).not.toHaveBeenCalled();
});

it("uses the designated owner despite multiple owners and an admin initiating checkout", async () => {
  await upgrade();
  expect(gateway.createTeam).toHaveBeenCalledWith(
    expect.objectContaining({
      owner: expect.objectContaining({ id: "owner" }),
    }),
  );
  expect(
    [...members.values()]
      .filter((m) => m.role === "owner")
      .map((m) => m.externalId),
  ).toEqual(["owner"]);
  expect([...members.values()].map((m) => m.externalId).sort()).toEqual([
    "admin",
    "other",
    "owner",
  ]);
  expect([...checkouts.values()][0].customerId).toBe([...customers.keys()][0]);
});
it("uses a member-scoped portal and never provisions missing customers", async () => {
  await expect(billing.openPortal("org", "admin")).rejects.toMatchObject({
    code: "customer_missing",
  });
  expect(serverLogger.error).toHaveBeenCalledWith("billing.portal.failed", {
    "everr.billing.error.code": "customer_missing",
    "everr.organization.id": "org",
    "error.type": "BillingError",
  });
  expect(gateway.createTeam).not.toHaveBeenCalled();
  await upgrade();
  await expect(billing.openPortal("org", "admin")).resolves.toEqual({
    url: expect.stringContaining("https://polar.example/portal/"),
  });
  expect(gateway.portal).toHaveBeenCalledWith(
    [...customers.keys()][0],
    [...members.values()].find((m) => m.externalId === "admin")?.id,
  );
});
it("lets the same person own different customers without using their email as customer identity", async () => {
  await upgrade();
  await billing.startNewOrganizationCheckout("owner", "New");
  expect(customers.size).toBe(2);
  expect(
    [...members.values()].filter((m) => m.externalId === "owner").length,
  ).toBe(2);
});
it("resumes new Pro checkout and does not create the org before payment", async () => {
  const first = await billing.startNewOrganizationCheckout("owner", "New");
  const [attempt] = await database
    .select()
    .from(schema.proOrganizationCheckout);
  expect(attempt.orgId).toMatch(/^[a-zA-Z0-9]{32}$/);
  expect([...checkouts.values()][0].externalCustomerId).toBe(attempt.orgId);
  expect(await billing.startNewOrganizationCheckout("owner", "New")).toEqual(
    first,
  );
  expect(gateway.createCheckout).toHaveBeenCalledTimes(1);
  expect(await database.select().from(schema.organization)).toHaveLength(1);
});
it("recovers an uncertain checkout creation without duplicating it", async () => {
  const original = required(gateway.createCheckout.getMockImplementation());
  gateway.createCheckout.mockImplementationOnce(async (input) => {
    await original(input);
    throw new Error("lost response");
  });
  await expect(
    billing.startNewOrganizationCheckout("owner", "New"),
  ).rejects.toThrow("lost response");
  await billing.startNewOrganizationCheckout("owner", "New");
  expect(gateway.createCheckout).toHaveBeenCalledTimes(1);
});
it("recovers uncertain team creation by external ID", async () => {
  const original = required(gateway.createTeam.getMockImplementation());
  gateway.createTeam.mockImplementationOnce(async (input) => {
    await original(input);
    throw new Error("lost response");
  });
  await upgrade();
  expect(customers.size).toBe(1);
});
it("retains reserved identity when replacing an expired checkout", async () => {
  await billing.startNewOrganizationCheckout("owner", "New");
  const old = [...checkouts.values()][0];
  old.status = "expired";
  await billing.startNewOrganizationCheckout("owner", "New");
  expect(checkouts.size).toBe(2);
  expect(
    new Set([...checkouts.values()].map((c) => c.externalCustomerId)).size,
  ).toBe(1);
});
it("finalizes from a webhook without redirect and tolerates duplicates and later redirects", async () => {
  const { c, event } = await paidNew();
  await billing.syncSubscription(event, createOrganization);
  await billing.syncSubscription(event, createOrganization);
  expect(
    await billing.completeNewOrganizationCheckout(
      c.id,
      "owner",
      createOrganization,
    ),
  ).toMatchObject({ status: "completed" });
  expect(createOrganization).toHaveBeenCalledTimes(1);
  expect(await database.select().from(schema.orgSubscription)).toHaveLength(1);
});
it("retries a partial provisioning failure without recreating the org", async () => {
  const { c } = await paidNew();
  provision.mockRejectedValueOnce(new Error("provision"));
  await expect(
    billing.completeNewOrganizationCheckout(c.id, "owner", createOrganization),
  ).rejects.toThrow("provision");
  await billing.completeNewOrganizationCheckout(
    c.id,
    "owner",
    createOrganization,
  );
  expect(createOrganization).toHaveBeenCalledTimes(1);
});
it("keeps processing subscription events after the original creator transfers ownership and deletes their account", async () => {
  const { c, s, event } = await paidNew();
  await billing.syncSubscription(event, createOrganization);
  const orgId = required(c.externalCustomerId);
  await database.insert(schema.member).values({
    id: randomUUID(),
    organizationId: orgId,
    userId: "other",
    role: "owner",
    createdAt: new Date(),
  });
  await billing.afterMembershipChange(orgId);
  await billing.changeOwner(orgId, "owner", "other");
  await billing.beforeUserDelete("owner");
  await database.delete(schema.member).where(eq(schema.member.userId, "owner"));
  await database.delete(schema.user).where(eq(schema.user.id, "owner"));
  await billing.afterMembershipChange(orgId);

  const canceled = {
    ...s,
    status: "canceled",
    modifiedAt: new Date(s.createdAt.getTime() + 1000),
  };
  subscriptions.set(s.id, canceled);
  await billing.syncSubscription(
    { data: { ...event.data, ...canceled } },
    createOrganization,
  );
  expect(
    (await database.select().from(schema.orgSubscription))[0],
  ).toMatchObject({
    orgId,
    status: "canceled",
  });
  expect(
    await database.select().from(schema.proOrganizationCheckout),
  ).toHaveLength(1);
  expect(createOrganization).toHaveBeenCalledOnce();
});

it("rejects an upgrade checkout for an active organization created on Pro", async () => {
  const { c, event } = await paidNew();
  await billing.syncSubscription(event, createOrganization);
  await expect(
    billing.startUpgradeCheckout(required(c.externalCustomerId), "owner"),
  ).rejects.toMatchObject({ code: "already_active" });
  expect(gateway.createCheckout).toHaveBeenCalledOnce();
});
it("rejects foreign checkout ownership, wrong customer and version 1", async () => {
  const { c } = await paidNew();
  await expect(
    billing.completeNewOrganizationCheckout(c.id, "other", createOrganization),
  ).rejects.toMatchObject({ code: "forbidden" });
  c.metadata.everrSchemaVersion = 1;
  await expect(
    billing.completeNewOrganizationCheckout(c.id, "owner", createOrganization),
  ).rejects.toMatchObject({ code: "unsupported_checkout" });
  c.metadata.everrSchemaVersion = 2;
  c.customerId = "foreign";
  await expect(
    billing.completeNewOrganizationCheckout(c.id, "owner", createOrganization),
  ).rejects.toMatchObject({ code: "identity_conflict" });
  expect(createOrganization).not.toHaveBeenCalled();
});
it("does not grant Pro for incomplete payment or wrong product", async () => {
  await billing.startNewOrganizationCheckout("owner", "New");
  const c = [...checkouts.values()][0];
  expect(
    await billing.completeNewOrganizationCheckout(
      c.id,
      "owner",
      createOrganization,
    ),
  ).toEqual({ status: "processing" });
  c.productId = "foreign";
  await expect(
    billing.completeNewOrganizationCheckout(c.id, "owner", createOrganization),
  ).rejects.toThrow();
  expect(createOrganization).not.toHaveBeenCalled();
});
it("preserves newer canceled subscription state against an old active event", async () => {
  const { event, s } = await paidNew();
  await billing.syncSubscription(event, createOrganization);
  await billing.syncSubscription(
    {
      data: {
        ...event.data,
        status: "canceled",
        modifiedAt: new Date(s.createdAt.getTime() + 1000),
      },
    },
    createOrganization,
  );
  await billing.syncSubscription(event, createOrganization);
  expect((await database.select().from(schema.orgSubscription))[0].status).toBe(
    "canceled",
  );
});
it("transfers billing to another owner and prevents owner removal before transfer", async () => {
  await upgrade();
  await expect(
    billing.beforeMembershipChange("org", "owner", null),
  ).rejects.toMatchObject({ code: "owner_required" });
  await billing.changeOwner("org", "other", "other");
  expect((await billing.getSettings("org", "owner")).owner?.id).toBe("other");
  expect(
    [...members.values()].find((m) => m.role === "owner")?.externalId,
  ).toBe("other");
  await expect(
    billing.changeOwner("org", "admin", "owner"),
  ).rejects.toMatchObject({ code: "forbidden" });
});
it("revokes managed access before committing removal and preserves independent contacts", async () => {
  await upgrade();
  const external: BillingMember = {
    id: "external",
    externalId: null,
    customerId: [...customers.keys()][0],
    email: "finance@example.com",
    name: "Finance",
    role: "billing_manager",
  };
  members.set(external.id, external);
  const admin = required(
    [...members.values()].find((m) => m.externalId === "admin"),
  );
  await billing.beforeMembershipChange("org", "admin", null);
  expect(members.has(admin.id)).toBe(false);
  await expect(gateway.portal(admin.customerId, admin.id)).rejects.toThrow(
    "revoked",
  );
  await database.delete(schema.member).where(eq(schema.member.userId, "admin"));
  await billing.afterMembershipChange("org");
  expect(members.get(external.id)).toEqual(external);
  await expect(billing.openPortal("org", "admin")).rejects.toMatchObject({
    code: "forbidden",
  });
});
it("blocks a failed revocation without leaving a persistent portal block", async () => {
  await upgrade();
  gateway.deleteMember.mockRejectedValueOnce(new Error("offline"));
  await expect(
    billing.beforeMembershipChange("org", "admin", null),
  ).rejects.toThrow("offline");
  expect(
    (await database.select().from(schema.member)).some(
      (m) => m.userId === "admin",
    ),
  ).toBe(true);
  await expect(billing.openPortal("org", "owner")).resolves.toMatchObject({
    url: expect.stringContaining("https://polar.example/portal/"),
  });
});
it.each([
  [
    "membership removal",
    () => billing.beforeMembershipChange("org", "admin", null),
  ],
  ["account deletion", () => billing.beforeUserDelete("admin")],
])("reconciles on the next portal access when %s never commits", async (_name, revoke) => {
  await upgrade();
  await revoke();
  expect([...members.values()].some((m) => m.externalId === "admin")).toBe(
    false,
  );
  await billing.openPortal("org", "owner");
  expect([...members.values()].some((m) => m.externalId === "admin")).toBe(
    true,
  );
});
it("updates email by member ID and refuses to adopt an independent contact", async () => {
  await upgrade();
  const before = required(
    [...members.values()].find((m) => m.externalId === "admin"),
  );
  await billing.beforeUserUpdate("admin", {
    email: "changed@example.com",
    emailVerified: true,
  });
  await database
    .update(schema.user)
    .set({ email: "changed@example.com" })
    .where(eq(schema.user.id, "admin"));
  await billing.afterUserUpdate("admin");
  expect(members.get(before.id)?.email).toBe("changed@example.com");
  members.set("collision", {
    id: "collision",
    externalId: null,
    customerId: before.customerId,
    email: "collision@example.com",
    name: "Finance",
    role: "billing_manager",
  });
  await expect(
    billing.beforeUserUpdate("admin", {
      email: "collision@example.com",
      emailVerified: true,
    }),
  ).rejects.toMatchObject({ code: "identity_conflict" });
});
it("adopts a matching team and preserves its Polar owner without local owner configuration", async () => {
  await gateway.createTeam({
    orgId: "org",
    owner: { id: "other", name: "Other", email: "other@example.com" },
  });
  await billing.startUpgradeCheckout("org", "owner");
  expect((await billing.getSettings("org", "owner")).owner?.id).toBe("other");
  expect(gateway.createTeam).toHaveBeenCalledTimes(1);
});

it("resumes a paid upgrade before the webhook instead of selling another subscription", async () => {
  await upgrade();
  const c = [...checkouts.values()][0];
  c.status = "succeeded";
  subscriptions.set("upgrade-sub", {
    id: "upgrade-sub",
    customerId: required(c.customerId),
    checkoutId: c.id,
    productId: "pro",
    status: "active",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    modifiedAt: null,
    createdAt: new Date(),
  });
  expect((await billing.startUpgradeCheckout("org", "owner")).url).toContain(
    `/checkout/success?checkout_id=${c.id}`,
  );
  await billing.confirmUpgradeCheckout("org", "owner", c.id);
  await expect(
    billing.startUpgradeCheckout("org", "owner"),
  ).rejects.toMatchObject({
    code: "already_active",
  });
  expect(gateway.createCheckout).toHaveBeenCalledTimes(1);
});
it("serializes concurrent attempts for the same owner and trimmed name", async () => {
  const results = await Promise.allSettled([
    billing.startNewOrganizationCheckout("owner", " New "),
    billing.startNewOrganizationCheckout("owner", "New"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(gateway.createTeam).toHaveBeenCalledTimes(1);
  await billing.startNewOrganizationCheckout("owner", "New");
  expect(gateway.createCheckout).toHaveBeenCalledTimes(1);
});
it("allows another organization with the same name after completing the first", async () => {
  const { event } = await paidNew();
  await billing.syncSubscription(event, createOrganization);
  await billing.startNewOrganizationCheckout("owner", "New");
  expect(
    await database.select().from(schema.proOrganizationCheckout),
  ).toHaveLength(2);
  expect(customers.size).toBe(2);
});
it("synchronizes promotions and rejects demotion or deletion of the billing owner", async () => {
  await upgrade();
  await billing.beforeMembershipChange("org", "regular", "admin");
  await database
    .update(schema.member)
    .set({ role: "admin" })
    .where(eq(schema.member.userId, "regular"));
  await billing.afterMembershipChange("org");
  expect(
    [...members.values()].find((m) => m.externalId === "regular")?.role,
  ).toBe("billing_manager");
  await expect(
    billing.beforeMembershipChange("org", "owner", "admin"),
  ).rejects.toMatchObject({ code: "owner_required" });
  await expect(billing.beforeUserDelete("owner")).rejects.toMatchObject({
    code: "owner_required",
  });
});
it("revokes removed members before the downgrade commits", async () => {
  await upgrade();
  await billing.downgrade("org", "owner", async (revokeBillingAccess) => {
    await revokeBillingAccess();
    expect([...members.values()].map((m) => m.externalId)).toEqual(["owner"]);
    await client.exec(
      "DELETE FROM member WHERE user_id <> 'owner'; UPDATE organization SET plan = 'hobby' WHERE id = 'org'",
    );
  });
  await expect(billing.openPortal("org", "admin")).rejects.toMatchObject({
    code: "forbidden",
  });
});
it("keeps one owner when two owners downgrade concurrently without a billing customer", async () => {
  let enter = () => {};
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let proceed = () => {};
  const ready = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  const first = billing.downgrade("org", "owner", async (revoke) => {
    enter();
    await ready;
    await revoke();
    await client.exec("DELETE FROM member WHERE user_id <> 'owner'");
  });
  await entered;
  const secondCommit = vi.fn();
  try {
    await expect(
      billing.downgrade("org", "other", secondCommit),
    ).rejects.toThrow("busy");
    expect(secondCommit).not.toHaveBeenCalled();
  } finally {
    proceed();
    await first;
  }
  expect(
    await database
      .select({ userId: schema.member.userId, role: schema.member.role })
      .from(schema.member),
  ).toEqual([{ userId: "owner", role: "owner" }]);
});

it("rechecks local ownership inside the downgrade lock", async () => {
  await database.delete(schema.member).where(eq(schema.member.userId, "other"));
  const commit = vi.fn();
  await expect(billing.downgrade("org", "other", commit)).rejects.toMatchObject(
    {
      code: "forbidden",
    },
  );
  expect(commit).not.toHaveBeenCalled();
  expect(gateway.revokeSubscription).not.toHaveBeenCalled();
});

it("requires the current Polar team owner before downgrading", async () => {
  await upgrade();
  const commit = vi.fn();
  await expect(billing.downgrade("org", "other", commit)).rejects.toMatchObject(
    {
      code: "owner_required",
    },
  );
  expect(commit).not.toHaveBeenCalled();
  expect(gateway.revokeSubscription).not.toHaveBeenCalled();
});
it("rejects an individual customer without conversion", async () => {
  customers.set("individual", {
    id: "individual",
    type: "individual",
    externalId: "org",
  });
  await expect(
    billing.startUpgradeCheckout("org", "owner"),
  ).rejects.toMatchObject({ code: "identity_conflict" });
  expect(gateway.createTeam).not.toHaveBeenCalled();
  expect(gateway.createCheckout).not.toHaveBeenCalled();
});
it("refuses a mismatched subscription after its organization is finalized", async () => {
  const { event, c } = await paidNew();
  await billing.syncSubscription(event, createOrganization);
  c.subscriptionId = "sub";
  await expect(
    billing.syncSubscription(
      { data: { ...event.data, id: "other-sub" } },
      createOrganization,
    ),
  ).rejects.toMatchObject({ code: "identity_conflict" });
});
it("does not grant Pro from an upgrade webhook before payment succeeds", async () => {
  await upgrade();
  const c = [...checkouts.values()][0];
  const sub: Subscription = {
    id: "upgrade-sub",
    customerId: required(c.customerId),
    checkoutId: c.id,
    productId: "pro",
    status: "active",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    modifiedAt: null,
    createdAt: new Date(),
  };
  subscriptions.set(sub.id, sub);
  await billing.syncSubscription(
    {
      data: {
        ...sub,
        metadata: c.metadata,
        customer: { id: sub.customerId, externalId: "org" },
      },
    },
    createOrganization,
  );
  expect((await database.select().from(schema.organization))[0].plan).toBe(
    "hobby",
  );
  expect(await database.select().from(schema.orgSubscription)).toHaveLength(0);
});

it("does not revoke billing when the local downgrade eligibility check fails", async () => {
  await upgrade();
  gateway.deleteMember.mockClear();
  await expect(
    billing.downgrade("org", "owner", async () => {
      throw new Error("Hobby limit");
    }),
  ).rejects.toThrow("Hobby limit");
  expect(gateway.deleteMember).not.toHaveBeenCalled();
  expect(gateway.revokeSubscription).not.toHaveBeenCalled();
});

it("reflects ownership changes made directly in Polar", async () => {
  await upgrade();
  const other = required(
    [...members.values()].find((m) => m.externalId === "other"),
  );
  await gateway.updateMember(other.id, { role: "owner" });
  expect((await billing.getSettings("org", "owner")).owner?.id).toBe("other");
  await billing.beforeMembershipChange("org", "owner", "member");
  await expect(
    billing.beforeMembershipChange("org", "other", "member"),
  ).rejects.toMatchObject({ code: "owner_required" });
});
it("reconciles external IDs without local member mappings and preserves independent contacts", async () => {
  await upgrade();
  const customerId = [...customers.keys()][0];
  members.set("removed-user", {
    id: "removed-user",
    customerId,
    externalId: "deleted-everr-user",
    name: "Removed",
    email: "removed@example.com",
    role: "billing_manager",
  });
  members.set("independent", {
    id: "independent",
    customerId,
    externalId: null,
    name: "Finance",
    email: "finance@example.com",
    role: "billing_manager",
  });
  await billing.openPortal("org", "owner");
  expect(members.has("removed-user")).toBe(false);
  expect(members.has("independent")).toBe(true);
});

it("does not block checkout after a failed local membership write", async () => {
  await upgrade();
  await billing.beforeMembershipChange("org", "admin", null);
  expect([...members.values()].some((m) => m.externalId === "admin")).toBe(
    false,
  );
  await expect(
    billing.startUpgradeCheckout("org", "owner"),
  ).resolves.toHaveProperty("url");
  expect([...members.values()].some((m) => m.externalId === "admin")).toBe(
    true,
  );
});

it("stores the verified customer on the organization and reuses its ID", async () => {
  await upgrade();
  const [org] = await database.select().from(schema.organization);
  expect(org.polarCustomerId).toBe([...customers.keys()][0]);
  gateway.findCustomer.mockClear();
  await billing.openPortal("org", "owner");
  expect(gateway.findCustomer).not.toHaveBeenCalled();
  expect(gateway.getCustomer).toHaveBeenCalledWith(org.polarCustomerId);
});
it("does not replace a stored customer whose external ID belongs to another org", async () => {
  await upgrade();
  const customer = required([...customers.values()][0]);
  customer.externalId = "foreign-org";
  gateway.findCustomer.mockClear();
  await expect(
    billing.startUpgradeCheckout("org", "owner"),
  ).rejects.toMatchObject({ code: "identity_conflict" });
  expect(gateway.findCustomer).not.toHaveBeenCalled();
  expect(
    (await database.select().from(schema.organization))[0].polarCustomerId,
  ).toBe(customer.id);
});
it("copies the reserved customer onto the new Pro organization after payment", async () => {
  const { c, event } = await paidNew();
  await billing.syncSubscription(event, createOrganization);
  const [org] = await database
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, required(c.externalCustomerId)));
  expect(org.polarCustomerId).toBe(c.customerId);
});
