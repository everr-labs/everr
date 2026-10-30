// @vitest-environment node

import { createApplicationAuth } from "@everr/app/identity/module";
import { withTransactionReads } from "@everr/app/identity/testing/transaction-reads";
import type { IdentityEvent } from "@everr/app/identity/events";
import type { Database, DbExecutor, Transaction } from "@everr/app/db/client";
import { dashboards, invitation, member, organization, user } from "@everr/app/db/schema";
import {
  createTestDatabase,
  type TestDatabase,
} from "@everr/app/server/alerting/testing/pglite-database";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { organization as organizationPlugin } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { createAutomaticOrganizationSessionHook } from "../auto-org.server";
import {
  beforeCreateCheckoutOrganization,
  withOrganizationCreationId,
} from "../billing/organization-context.server";
import * as billingSchema from "../db/schema";
import { cloudTestMigrations } from "../testing/migrations";
import { isOrganizationProvisioned, parseOrganizationMetadata } from "./metadata";

vi.mock("@everr/app/db/client", () => ({
  db: undefined,
  runInTransaction: <T>(executor: DbExecutor, run: (tx: Transaction) => Promise<T>) =>
    executor instanceof PgTransaction ? run(executor) : executor.transaction(run),
}));

import { organizationLifecycleAdapter } from "./adapter.server";

const clickhouseMocks = vi.hoisted(() => ({
  provision: vi.fn(),
  deprovision: vi.fn(),
}));
vi.mock("../clickhouse/provisioning", () => ({
  provisionSqlApiOrgUser: clickhouseMocks.provision,
  deprovisionSqlApiOrgUser: clickhouseMocks.deprovision,
}));

import { waitForOrganizationProvisioning } from "./fast-path";
import { PROVISION_ORGANIZATION_TASK } from "./jobs";
import { createOrganizationTaskList } from "./runtime";

let fixture: TestDatabase;
let auth: ReturnType<typeof createAuth>;
function createAuth(
  afterCreateOrganization?: (input: {
    organization: { id: string; metadata?: unknown };
  }) => Promise<void>,
  afterCreateSession?: ReturnType<typeof createAutomaticOrganizationSessionHook>,
) {
  return betterAuth({
    baseURL: "http://localhost:3000",
    secret: "organization-lifecycle-test-secret-long-enough",
    emailAndPassword: { enabled: true },
    database: organizationLifecycleAdapter(fixture.db as unknown as Database),
    databaseHooks: {
      session: { create: { after: afterCreateSession } },
    },
    plugins: [
      organizationPlugin({
        organizationHooks: {
          beforeCreateOrganization: beforeCreateCheckoutOrganization,
          afterCreateOrganization,
        },
      }),
    ],
  } satisfies BetterAuthOptions);
}

let adapter: Pick<
  ReturnType<ReturnType<typeof organizationLifecycleAdapter>>,
  "create" | "delete" | "deleteMany" | "updateMany"
>;
beforeAll(async () => {
  fixture = await createTestDatabase(cloudTestMigrations);
  auth = createAuth();
  adapter = (await auth.$context).adapter;
});
afterAll(async () => fixture?.close());
beforeEach(async () => {
  clickhouseMocks.provision.mockReset();
  clickhouseMocks.deprovision.mockReset();
  await fixture.truncate();
  auth = createAuth();
  adapter = (await auth.$context).adapter;
});

const create = (id = "org-test") =>
  adapter.create({
    model: "organization",
    forceAllowId: true,
    data: {
      id,
      name: id,
      slug: id,
      createdAt: new Date(),
    },
  });
const where = [{ field: "id", value: "org-test" }];
const jobs = async () =>
  (
    await fixture.db.execute<{ task_identifier: string }>(
      sql`SELECT task_identifier FROM graphile_worker.jobs ORDER BY id`,
    )
  ).rows.map((j) => j.task_identifier);
// Make the actual add_job call fail inside the actual transaction. This proves
// rollback rather than asserting which executor a mocked enqueue received.
async function rejectEnqueues() {
  await fixture.client.exec(
    `CREATE FUNCTION graphile_worker.reject_test_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'enqueue rejected'; END $$; CREATE TRIGGER reject_test_job BEFORE INSERT ON graphile_worker._private_jobs FOR EACH ROW EXECUTE FUNCTION graphile_worker.reject_test_job()`,
  );
}
async function allowEnqueues() {
  await fixture.client.exec(
    `DROP TRIGGER reject_test_job ON graphile_worker._private_jobs; DROP FUNCTION graphile_worker.reject_test_job()`,
  );
}

it("commits organization creation and provisioning intent together", async () => {
  await create();
  expect(await jobs()).toEqual(["clickhouse/provision-organization"]);
  expect(
    isOrganizationProvisioned((await fixture.db.select().from(organization))[0].metadata),
  ).toBe(false);
});
it("rolls back creation if the queue cannot record provisioning intent", async () => {
  await rejectEnqueues();
  try {
    await expect(
      withOrganizationCreationId({ id: "org-test", slug: "org-test", ownerId: "owner" }, () =>
        create(),
      ),
    ).rejects.toThrow();
    expect(await fixture.db.select().from(organization)).toEqual([]);
    expect(await fixture.db.select().from(billingSchema.organizationBilling)).toEqual([]);
    expect(await jobs()).toEqual([]);
  } finally {
    await allowEnqueues();
  }
});
it("keeps the organization and its resources when recording cleanup fails", async () => {
  await create();
  await fixture.db.insert(dashboards).values({
    organizationId: "org-test",
    repoid: "test",
    project: "default",
    slug: "test",
    document: sql`'{}'::jsonb`,
  });
  await rejectEnqueues();
  try {
    await expect(adapter.delete({ model: "organization", where })).rejects.toThrow();
    expect(await fixture.db.select().from(organization)).toHaveLength(1);
    expect(await fixture.db.select().from(dashboards)).toHaveLength(1);
    expect(await jobs()).toEqual(["clickhouse/provision-organization"]);
  } finally {
    await allowEnqueues();
  }
  await adapter.delete({ model: "organization", where });
  expect(await fixture.db.select().from(organization)).toEqual([]);
  expect(await fixture.db.select().from(dashboards)).toEqual([]);
  expect(await jobs()).toEqual([
    "clickhouse/provision-organization",
    "clickhouse/deprovision-organization",
  ]);
});
it("records cleanup for every deleted organization", async () => {
  await create();
  await create("org-second");
  await adapter.deleteMany({
    model: "organization",
    where: [{ field: "id", operator: "in", value: ["org-test", "org-second"] }],
  });
  expect(await fixture.db.select().from(organization)).toEqual([]);
  expect(await jobs()).toEqual([
    "clickhouse/provision-organization",
    "clickhouse/provision-organization",
    "clickhouse/deprovision-organization",
    "clickhouse/deprovision-organization",
  ]);
});

async function signup(email = "owner@example.com") {
  const response = await auth.api.signUpEmail({
    body: {
      name: "Owner",
      email,
      password: "password-12345",
    },
    asResponse: true,
  });
  return new Headers({ cookie: response.headers.get("set-cookie") ?? "" });
}

it("protects provisioning metadata through actual create and update endpoints while preserving other metadata", async () => {
  const headers = await signup();
  const created = await auth.api.createOrganization({
    headers,
    body: {
      name: "Metadata",
      slug: "metadata",
      metadata: { clickhouseReady: true, label: "initial" },
    },
  });
  expect(created?.metadata).toEqual({
    clickhouseReady: false,
    label: "initial",
  });
  await auth.api.updateOrganization({
    headers,
    body: { data: { metadata: { clickhouseReady: true, label: "updated" } } },
  });
  let [stored] = await fixture.db.select().from(organization);
  expect(parseOrganizationMetadata(stored.metadata)).toEqual({
    clickhouseReady: false,
    label: "updated",
  });

  clickhouseMocks.provision.mockResolvedValue(undefined);
  const tasks = createOrganizationTaskList(fixture.db as unknown as Database, async () => {}, {
    async publish() {},
  });
  if (!created) throw new Error("Organization was not created");
  await tasks[PROVISION_ORGANIZATION_TASK]?.({ organizationId: created.id }, {} as never);
  [stored] = await fixture.db.select().from(organization);
  expect(parseOrganizationMetadata(stored.metadata)).toEqual({
    clickhouseReady: true,
    label: "updated",
  });
  await auth.api.updateOrganization({
    headers,
    body: { data: { metadata: { clickhouseReady: false, label: "ready" } } },
  });
  await auth.api.updateOrganization({
    headers,
    body: { data: { metadata: {} } },
  });
  [stored] = await fixture.db.select().from(organization);
  expect(parseOrganizationMetadata(stored.metadata)).toEqual({
    clickhouseReady: true,
  });
});

it("preserves readiness separately for every organization in a bulk metadata update", async () => {
  await create();
  await create("org-second");
  await fixture.client.exec(
    `UPDATE organization SET metadata = '{"clickhouseReady":true}' WHERE id = 'org-second'`,
  );
  await adapter.updateMany({
    model: "organization",
    where: [{ field: "id", operator: "in", value: ["org-test", "org-second"] }],
    update: {
      metadata: JSON.stringify({ clickhouseReady: true, label: "bulk" }),
    },
  });
  const rows = await fixture.db.select().from(organization);
  expect(
    rows.map((row) => ({
      id: row.id,
      metadata: parseOrganizationMetadata(row.metadata),
    })),
  ).toEqual(
    expect.arrayContaining([
      { id: "org-test", metadata: { clickhouseReady: false, label: "bulk" } },
      { id: "org-second", metadata: { clickhouseReady: true, label: "bulk" } },
    ]),
  );
});

function enableAutomaticOrganizations() {
  // PGlite has one connection, so it cannot hold the ownership transaction
  // while Better Auth opens its separate organization transaction. The lock's
  // concurrency behavior is covered by auto-org.server.test.ts.
  const database = Object.assign(Object.create(fixture.db), {
    transaction: (run: (executor: typeof fixture.db) => Promise<unknown>) => run(fixture.db),
  }) as Database;
  auth = createAuth(
    undefined,
    createAutomaticOrganizationSessionHook(
      (body) => auth.api.createOrganization({ body }),
      database,
    ),
  );
}

it("creates and selects an automatic Hobby organization after email signup commits", async () => {
  enableAutomaticOrganizations();
  const headers = await signup();
  const session = await auth.api.getSession({ headers });
  const [created] = await fixture.db.select().from(organization);
  expect(created).toMatchObject({
    name: "Owner's projects",
    metadata: JSON.stringify({ clickhouseReady: false }),
  });
  expect(await fixture.db.select().from(billingSchema.organizationBilling)).toEqual([
    expect.objectContaining({ orgId: created.id, plan: "hobby" }),
  ]);
  expect(session?.session.activeOrganizationId).toBe(created.id);
  expect(await fixture.db.select().from(member)).toEqual([
    expect.objectContaining({
      organizationId: created.id,
      userId: session?.user.id,
      role: "owner",
    }),
  ]);
  expect(await jobs()).toEqual([PROVISION_ORGANIZATION_TASK]);

  const response = await auth.api.signInEmail({
    body: { email: "owner@example.com", password: "password-12345" },
    asResponse: true,
  });
  const nextSession = await auth.api.getSession({
    headers: new Headers({ cookie: response.headers.get("set-cookie") ?? "" }),
  });
  expect(nextSession?.session.activeOrganizationId).toBe(created.id);
  expect(await fixture.db.select().from(organization)).toHaveLength(1);
  expect(await jobs()).toEqual([PROVISION_ORGANIZATION_TASK]);
});

it("keeps invited email signups without an unrelated automatic organization", async () => {
  await signup();
  const [inviter] = await fixture.db.select().from(user);
  await create();
  await fixture.db.insert(invitation).values({
    id: "pending-invitation",
    organizationId: "org-test",
    email: "invited@example.com",
    role: "member",
    status: "pending",
    inviterId: inviter.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  enableAutomaticOrganizations();
  const headers = await signup("invited@example.com");
  const session = await auth.api.getSession({ headers });
  expect(session?.session.activeOrganizationId).toBeNull();
  expect(await fixture.db.select().from(organization)).toHaveLength(1);
  expect(await jobs()).toEqual([PROVISION_ORGANIZATION_TASK]);
});

it("preserves the signup session if automatic organization enqueueing fails", async () => {
  enableAutomaticOrganizations();
  await rejectEnqueues();
  try {
    const headers = await signup();
    const session = await auth.api.getSession({ headers });
    expect(session?.user.email).toBe("owner@example.com");
    expect(session?.session.activeOrganizationId).toBeNull();
    expect(await fixture.db.select().from(organization)).toEqual([]);
    expect(await fixture.db.select().from(member)).toEqual([]);
    expect(await jobs()).toEqual([]);
  } finally {
    await allowEnqueues();
  }
});

it("runs the actual Better Auth create and delete endpoints through the lifecycle transaction", async () => {
  const headers = await signup();
  const owner = (await auth.api.getSession({ headers }))?.user;
  if (!owner) throw new Error("Owner missing");
  const created = await withOrganizationCreationId(
    { id: "verified-checkout-org", slug: "created", ownerId: owner.id },
    () =>
      auth.api.createOrganization({
        headers,
        body: { name: "Created", slug: "created" },
      }),
  );
  expect(created).toBeTruthy();
  if (!created) throw new Error("Organization creation returned no organization");
  expect(created.id).toBe("verified-checkout-org");
  expect(created).not.toHaveProperty("plan");
  expect(created).not.toHaveProperty("polarCustomerId");
  expect(await fixture.db.select().from(billingSchema.organizationBilling)).toEqual([
    { orgId: created.id, plan: "pro", polarCustomerId: null },
  ]);
  expect(await jobs()).toEqual(["clickhouse/provision-organization"]);
  await rejectEnqueues();
  try {
    await expect(
      auth.api.deleteOrganization({
        headers,
        body: { organizationId: created.id },
      }),
    ).rejects.toThrow();
    expect(await fixture.db.select().from(organization)).toHaveLength(1);
    expect((await fixture.client.query("SELECT * FROM member")).rows).toHaveLength(1);
    expect(await jobs()).toEqual(["clickhouse/provision-organization"]);
  } finally {
    await allowEnqueues();
  }
  await auth.api.deleteOrganization({
    headers,
    body: { organizationId: created.id },
  });
  expect(await fixture.db.select().from(organization)).toEqual([]);
  expect(await fixture.db.select().from(billingSchema.organizationBilling)).toEqual([]);
  expect((await fixture.client.query("SELECT * FROM member")).rows).toEqual([]);
  expect(await jobs()).toEqual([
    "clickhouse/provision-organization",
    "clickhouse/deprovision-organization",
  ]);
});

it("returns a ready organization from the actual endpoint when its durable job finishes during signup", async () => {
  clickhouseMocks.provision.mockResolvedValue(undefined);
  const database = fixture.db as unknown as Database;
  const tasks = createOrganizationTaskList(database, async () => {}, { async publish() {} });
  auth = createAuth(async ({ organization: created }) => {
    expect(await jobs()).toEqual([PROVISION_ORGANIZATION_TASK]);
    const pending = waitForOrganizationProvisioning(created.id, database);
    await tasks[PROVISION_ORGANIZATION_TASK]?.({ organizationId: created.id }, {} as never);
    if (await pending)
      Object.assign(created, {
        metadata: {
          ...parseOrganizationMetadata(created.metadata),
          clickhouseReady: true,
        },
      });
  });
  const headers = await signup();
  const created = await auth.api.createOrganization({
    headers,
    body: { name: "Fast", slug: "fast" },
  });
  expect(isOrganizationProvisioned(created?.metadata)).toBe(true);
  expect(
    isOrganizationProvisioned((await fixture.db.select().from(organization))[0].metadata),
  ).toBe(true);
  expect(clickhouseMocks.provision).toHaveBeenCalledOnce();
});

it("preserves atomic provisioning and cleanup under the shared post-commit identity adapter", async () => {
  const database = withTransactionReads(fixture.db as unknown as Database);
  const facts: IdentityEvent[] = [];
  const shared = createApplicationAuth(
    {
      policy: {
        beforeUserCreate: async () => {},
        beforeUserDelete: async () => {},
        beforeMembershipChange: async () => {},
        afterMembershipChange: async () => {},
        assertAccountDeletionAllowed: async () => {},
        assertDeletable: async () => {},
      },
      provider: {
        withIdentityRequest: (run) => run(),
        lockUserLifecycle: async () => {},
        lockAccountDeletion: async () => {},
        identityAdapter: (executor) => organizationLifecycleAdapter(executor),
        organizationHooks: () => ({}),
        createSessionOnboardingHook: () => async () => {},
      },
    },
    {
      database,
      events: {
        publish: async (fact) => {
          facts.push(fact);
        },
      },
      baseURL: "http://localhost:3000",
      secret: "combined-organization-lifecycle-secret-long-enough",
      email: { enabled: false, sendInvitation() {}, sendPasswordReset() {}, sendVerification() {} },
      canInviteMembers: async () => true,
    },
  );
  const response = await shared.api.signUpEmail({
    body: { name: "Owner", email: "shared@example.test", password: "long-test-password" },
    asResponse: true,
  });
  const headers = new Headers({ cookie: response.headers.get("set-cookie") ?? "" });
  const owner = (await shared.api.getSession({ headers }))!.user;
  facts.length = 0;
  await rejectEnqueues();
  try {
    await expect(
      shared.api.createOrganization({
        body: { name: "Rejected", slug: "rejected", userId: owner.id },
      }),
    ).rejects.toThrow();
    expect(await fixture.db.select().from(organization)).toEqual([]);
    expect(await fixture.db.select().from(billingSchema.organizationBilling)).toEqual([]);
    expect(facts).toEqual([]);
  } finally {
    await allowEnqueues();
  }
  const created = await shared.api.createOrganization({
    body: { name: "Shared", slug: "shared", userId: owner.id },
  });
  if (!created) throw new Error("Missing organization");
  expect(await jobs()).toEqual([PROVISION_ORGANIZATION_TASK]);
  expect(facts.map((fact) => fact.type)).toEqual(["organization.created", "membership.added"]);
  const membershipFact = facts[1];
  facts.length = 0;
  await rejectEnqueues();
  try {
    await expect(
      shared.api.deleteOrganization({ headers, body: { organizationId: created.id } }),
    ).rejects.toThrow();
    expect(await fixture.db.select().from(organization)).toHaveLength(1);
    expect(await fixture.db.select().from(member)).toHaveLength(1);
    expect(facts).toEqual([]);
  } finally {
    await allowEnqueues();
  }
  await shared.api.deleteOrganization({ headers, body: { organizationId: created.id } });
  expect(await fixture.db.select().from(organization)).toEqual([]);
  expect(await jobs()).toEqual([
    PROVISION_ORGANIZATION_TASK,
    "clickhouse/deprovision-organization",
  ]);
  expect(facts).toEqual([
    { ...membershipFact, type: "membership.removed" },
    {
      type: "organization.deleted",
      version: 1,
      subjectId: created.id,
      data: { organizationId: created.id },
    },
  ]);

  const bulk = [];
  for (const slug of ["bulk-first", "bulk-second"]) {
    const org = await shared.api.createOrganization({
      body: { name: "Bulk", slug, userId: owner.id },
    });
    if (!org) throw new Error("Missing bulk organization");
    bulk.push(org);
  }
  await fixture.db.insert(dashboards).values(
    bulk.map((org) => ({
      organizationId: org.id,
      repoid: "bulk",
      project: "default",
      slug: "test",
      document: sql`'{}'::jsonb`,
    })),
  );
  const { adapter: sharedAdapter } = await shared.$context;
  const bulkDelete = { model: "organization", where: [{ field: "name", value: "Bulk" }] };
  facts.length = 0;
  await rejectEnqueues();
  try {
    await expect(sharedAdapter.delete(bulkDelete)).rejects.toThrow();
    expect(await fixture.db.select().from(organization)).toHaveLength(2);
    expect(await fixture.db.select().from(dashboards)).toHaveLength(2);
    expect(facts).toEqual([]);
  } finally {
    await allowEnqueues();
  }
  await sharedAdapter.delete(bulkDelete);
  expect(await fixture.db.select().from(organization)).toEqual([]);
  expect(await fixture.db.select().from(dashboards)).toEqual([]);
  expect((await jobs()).slice(-2)).toEqual([
    "clickhouse/deprovision-organization",
    "clickhouse/deprovision-organization",
  ]);
  expect(facts).toHaveLength(2);
  expect(facts).toEqual(
    expect.arrayContaining(
      bulk.map((org) => ({
        type: "organization.deleted",
        version: 1,
        subjectId: org.id,
        data: { organizationId: org.id },
      })),
    ),
  );
});
