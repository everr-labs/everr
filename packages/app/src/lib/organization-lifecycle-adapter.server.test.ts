// @vitest-environment node
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { organization as organizationPlugin } from "better-auth/plugins";
import { eq, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { organizationProvisioningFields } from "@/common/organization-provisioning-fields";
import type { Database, DbExecutor, Transaction } from "@/db/client";
import { dashboards, organization } from "@/db/schema";
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

let fixture: TestDatabase;
let auth: ReturnType<typeof createAuth>;
function createAuth() {
  return betterAuth({
    baseURL: "http://localhost:3000",
    secret: "organization-lifecycle-test-secret-long-enough",
    emailAndPassword: { enabled: true },
    database: organizationLifecycleAdapter(fixture.db as unknown as Database),
    plugins: [
      organizationPlugin({
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

async function signup() {
  const response = await auth.api.signUpEmail({
    body: {
      name: "Owner",
      email: "owner@example.com",
      password: "password-12345",
    },
    asResponse: true,
  });
  return new Headers({ cookie: response.headers.get("set-cookie") ?? "" });
}
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
