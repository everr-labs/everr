// @vitest-environment node
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { organization as organizationPlugin } from "better-auth/plugins";
import { eq, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { organizationProvisioningFields } from "@/common/organization-provisioning-fields";
import type { Database, DbExecutor, Transaction } from "@/db/client";
import {
  dashboards,
  invitation,
  member,
  organization,
  user,
} from "@/db/schema";
import { createAutomaticOrganizationSessionHook } from "@/lib/auto-org.server";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/server/alerting/testing/pglite-database";

vi.mock("@/db/client", () => ({
  db: undefined,
  runInTransaction: <T>(
    executor: DbExecutor,
    run: (tx: Transaction) => Promise<T>,
  ) =>
    executor instanceof PgTransaction
      ? run(executor)
      : executor.transaction(run),
}));

import { organizationLifecycleAdapter } from "./organization-lifecycle-adapter.server";

const clickhouseMocks = vi.hoisted(() => ({
  provision: vi.fn(),
  deprovision: vi.fn(),
}));
vi.mock("@/lib/clickhouse", () => ({
  provisionSqlApiOrgUser: clickhouseMocks.provision,
  deprovisionSqlApiOrgUser: clickhouseMocks.deprovision,
}));

import { waitForOrganizationProvisioning } from "@/server/organization-provisioning/fast-path";
import { PROVISION_ORGANIZATION_TASK } from "@/server/organization-provisioning/jobs";
import { createOrganizationTaskList } from "@/server/organization-provisioning/runtime";

let fixture: TestDatabase;
let auth: ReturnType<typeof createAuth>;
function createAuth(
  afterCreateOrganization?: (input: {
    organization: { id: string };
  }) => Promise<void>,
  afterCreateSession?: ReturnType<
    typeof createAutomaticOrganizationSessionHook
  >,
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
        organizationHooks: { afterCreateOrganization },
        schema: {
          organization: { additionalFields: organizationProvisioningFields },
        },
      }),
    ],
  } satisfies BetterAuthOptions);
}

let adapter: Pick<
  ReturnType<ReturnType<typeof organizationLifecycleAdapter>>,
  "create" | "delete" | "deleteMany"
>;
beforeAll(async () => {
  fixture = await createTestDatabase();
  auth = createAuth();
  adapter = (await auth.$context).adapter;
});
afterAll(async () => fixture?.close());
beforeEach(async () => {
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
      clickhouseReady: false,
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
    (await fixture.db.select().from(organization))[0].clickhouseReady,
  ).toBe(false);
});
it("rolls back creation if the queue cannot record provisioning intent", async () => {
  await rejectEnqueues();
  try {
    await expect(create()).rejects.toThrow();
    expect(await fixture.db.select().from(organization)).toEqual([]);
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
    await expect(
      adapter.delete({ model: "organization", where }),
    ).rejects.toThrow();
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
  expect(
    await fixture.db
      .select()
      .from(organization)
      .where(eq(organization.clickhouseReady, false)),
  ).toEqual([]);
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

function enableAutomaticOrganizations() {
  // PGlite has one connection, so it cannot hold the ownership transaction
  // while Better Auth opens its separate organization transaction. The lock's
  // concurrency behavior is covered by auto-org.server.test.ts.
  const database = Object.assign(Object.create(fixture.db), {
    transaction: (run: (executor: typeof fixture.db) => Promise<unknown>) =>
      run(fixture.db),
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
    plan: "hobby",
    clickhouseReady: false,
  });
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
  const created = await auth.api.createOrganization({
    headers,
    body: { name: "Created", slug: "created" },
  });
  expect(created).toBeTruthy();
  if (!created)
    throw new Error("Organization creation returned no organization");
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
    expect(
      (await fixture.client.query("SELECT * FROM member")).rows,
    ).toHaveLength(1);
    expect(await jobs()).toEqual(["clickhouse/provision-organization"]);
  } finally {
    await allowEnqueues();
  }
  await auth.api.deleteOrganization({
    headers,
    body: { organizationId: created.id },
  });
  expect(await fixture.db.select().from(organization)).toEqual([]);
  expect((await fixture.client.query("SELECT * FROM member")).rows).toEqual([]);
  expect(await jobs()).toEqual([
    "clickhouse/provision-organization",
    "clickhouse/deprovision-organization",
  ]);
});

it("returns a ready organization from the actual endpoint when its durable job finishes during signup", async () => {
  clickhouseMocks.provision.mockResolvedValue(undefined);
  const database = fixture.db as unknown as Database;
  const tasks = createOrganizationTaskList(database, async () => {});
  auth = createAuth(async ({ organization: created }) => {
    expect(await jobs()).toEqual([PROVISION_ORGANIZATION_TASK]);
    const pending = waitForOrganizationProvisioning(created.id, database);
    await tasks[PROVISION_ORGANIZATION_TASK]?.(
      { organizationId: created.id },
      {} as never,
    );
    if (await pending) Object.assign(created, { clickhouseReady: true });
  });
  const headers = await signup();
  const created = await auth.api.createOrganization({
    headers,
    body: { name: "Fast", slug: "fast" },
  });
  expect(created?.clickhouseReady).toBe(true);
  expect(
    (await fixture.db.select().from(organization))[0].clickhouseReady,
  ).toBe(true);
  expect(clickhouseMocks.provision).toHaveBeenCalledOnce();
});
