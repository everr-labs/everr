// @vitest-environment node

import type { Database } from "@everr/app/db/database";
import { member, organization, user } from "@everr/app/db/schema";
import {
  createTestDatabase,
  type TestDatabase,
} from "@everr/app/server/alerting/testing/pglite-database";
import { eq, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { crmProjection, organizationBilling, orgSubscription } from "../db/schema";
import { createCrmSnapshotReader, projectionIdentity } from "./snapshots";
import { createCrmProjectionStore } from "./store";
import { createMilestoneTestTable } from "../organizations/testing/database";

vi.mock("@everr/app/db/client", () => ({ db: undefined }));
vi.mock("../app/env", () => ({ appEnv: { POLAR_PRO_PRODUCT_ID: "product_pro" } }));

let fixture: TestDatabase;
let reader: ReturnType<typeof createCrmSnapshotReader>;
let store: ReturnType<typeof createCrmProjectionStore>;
const joined = new Date("2026-01-02T03:04:05Z");

beforeAll(async () => {
  fixture = await createTestDatabase([
    {
      migrationsFolder: `${import.meta.dirname}/../drizzle`,
      migrationsTable: "__everr_cloud_migrations",
      migrationsSchema: "drizzle",
    },
  ]);
  // Exercise the new schema source in a disposable in-memory DB. No migration
  // artifacts are generated or applied to any application database.
  const config = getTableConfig(crmProjection);
  const dialect = new PgDialect();
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const columns = config.columns.map((column) => {
    const defaultSql =
      column.default instanceof SQL
        ? dialect.sqlToQuery(column.default).sql
        : column.default === undefined
          ? undefined
          : typeof column.default === "string"
            ? `'${column.default}'`
            : JSON.stringify(column.default);
    return `${quote(column.name)} ${column.getSQLType()}${column.notNull ? " NOT NULL" : ""}${defaultSql === undefined ? "" : ` DEFAULT ${defaultSql}`}`;
  });
  const primary = config.primaryKeys[0].columns.map((column) => quote(column.name)).join(",");
  const checks = config.checks.map(
    (check) => `CONSTRAINT ${quote(check.name)} CHECK (${dialect.sqlToQuery(check.value).sql})`,
  );
  await fixture.client.exec(
    `CREATE TABLE crm_projection (${[...columns, `PRIMARY KEY (${primary})`, ...checks].join(",")})`,
  );
  for (const index of config.indexes) {
    const names = index.config.columns.map((column) => quote((column as { name: string }).name));
    await fixture.client.exec(
      `CREATE UNIQUE INDEX ${quote(index.config.name!)} ON crm_projection (${names.join(",")})`,
    );
  }
  const database = fixture.db as unknown as Database;
  await createMilestoneTestTable(fixture.client);
  reader = createCrmSnapshotReader(database, "test");
  store = createCrmProjectionStore(database, "test");
});

afterAll(async () => fixture?.close());
beforeEach(async () => {
  // CRM was added after createTestDatabase discovered its tables.
  await fixture.client.exec("TRUNCATE crm_projection, organization_milestones");
  await fixture.truncate();
  await fixture.db
    .insert(user)
    .values({ id: "user", name: "Original", email: "before@example.test", createdAt: joined });
  await fixture.db.insert(organization).values([
    { id: "hobby", name: "Personal", slug: "personal", createdAt: joined },
    {
      id: "pro",
      name: "Team",
      slug: "team",
      createdAt: joined,
      metadata: JSON.stringify({ clickhouseReady: false }),
    },
  ]);
  await fixture.db.insert(member).values([
    {
      id: "member-hobby",
      userId: "user",
      organizationId: "hobby",
      role: "owner",
      createdAt: joined,
    },
    { id: "member-pro", userId: "user", organizationId: "pro", role: "member", createdAt: joined },
  ]);
  await fixture.db.insert(organizationBilling).values({ orgId: "pro", plan: "pro" });
  await fixture.db.insert(orgSubscription).values({
    orgId: "pro",
    polarSubscriptionId: "sub",
    polarProductId: "product_pro",
    status: "past_due",
    currentPeriodEnd: joined,
    cancelAtPeriodEnd: true,
    polarModifiedAt: joined,
  });
});

it("loads current user fields and all memberships while preserving stable deployment identity", async () => {
  const first = await reader.user("user");
  expect(first).toMatchObject({
    kind: "user",
    deleted: false,
    fields: { email: "before@example.test", registeredAt: joined.toISOString() },
    memberships: [{ organizationId: "hobby" }, { organizationId: "pro" }],
  });
  await fixture.db
    .update(user)
    .set({ name: "Changed", email: "after@example.test", emailVerified: true })
    .where(eq(user.id, "user"));
  const latest = await reader.user("user");
  expect(latest).toMatchObject({
    externalId: first.externalId,
    fields: { name: "Changed", email: "after@example.test", emailVerified: true },
  });
  expect(projectionIdentity("other", { kind: "user", id: "user" }).externalId).not.toBe(
    first.externalId,
  );
  expect(projectionIdentity("test:a", { kind: "user", id: "b" }).externalId).not.toBe(
    projectionIdentity("test", { kind: "user", id: "a:b" }).externalId,
  );
});

it("uses authoritative entitlements and keeps provisioning independent from activation", async () => {
  const pending = await reader.organization("pro");
  expect(pending).toMatchObject({
    fields: {
      plan: "pro",
      appState: "suspended",
      subscriptionStatus: "past_due",
      provisioning: "pending",
      cancelAtPeriodEnd: true,
    },
    memberships: [{ userId: "user", role: "member" }],
  });
  expect(pending).toHaveProperty("fields.activatedAt", null);
  expect(pending).toHaveProperty("fields.firstQueryableAt", null);
  await expect(reader.organization("hobby")).resolves.toMatchObject({
    fields: { plan: "hobby", appState: "hobby", subscriptionStatus: null, provisioning: "ready" },
  });
  await fixture.db
    .update(orgSubscription)
    .set({ status: "active" })
    .where(eq(orgSubscription.orgId, "pro"));
  await fixture.db
    .update(organization)
    .set({ name: "Renamed", metadata: '{"clickhouseReady":true}' })
    .where(eq(organization.id, "pro"));
  const ready = await reader.organization("pro");
  expect(ready).toMatchObject({
    externalId: pending.externalId,
    fields: {
      name: "Renamed",
      plan: "pro",
      appState: "pro",
      subscriptionStatus: "active",
      provisioning: "ready",
      cancelAtPeriodEnd: true,
    },
  });
  expect(ready).toHaveProperty("fields.activatedAt", null);
});

it("keeps billing product validation authoritative", async () => {
  await fixture.db.update(orgSubscription).set({ polarProductId: "unknown" });
  await expect(reader.organization("pro")).rejects.toThrow("not configured");
});

it("avoids unchanged revisions, retains last success, and rejects stale outcomes", async () => {
  const snapshot = await reader.user("user");
  const initial = await store.desire(snapshot);
  expect(initial).toMatchObject({ outcome: "pending", desiredRevision: 1, syncedRevision: null });
  const unchanged = await store.desire({ ...snapshot });
  expect(unchanged.desiredRevision).toBe(1);
  expect(await store.markFailed(initial, 1, "rate_limited")).toBe(true);
  expect(await store.read(initial)).toMatchObject({
    outcome: "failed",
    lastErrorCode: "rate_limited",
    lastErrorAt: expect.any(Date),
  });
  await store.bindRemote(initial, { remoteId: "contact-1" });
  expect(await store.markSynced(initial, 1)).toBe(true);
  expect(await store.markFailed(initial, 1, "timeout")).toBe(false);
  const synced = await store.read(initial);
  expect(synced).toMatchObject({
    outcome: "synced",
    syncedRevision: 1,
    lastSuccessAt: expect.any(Date),
    lastErrorCode: null,
  });
  await fixture.db.update(user).set({ email: "latest@example.test" }).where(eq(user.id, "user"));
  const changed = await store.desire(await reader.user("user"));
  expect(changed).toMatchObject({
    outcome: "pending",
    desiredRevision: 2,
    syncedRevision: 1,
    remoteId: "contact-1",
    lastSuccessAt: synced!.lastSuccessAt,
  });
  expect(await store.markSynced(changed, 1)).toBe(false);
  expect(await store.markFailed(changed, 1, "timeout")).toBe(false);
  expect(await store.markFailed(changed, 2, "invalid_schema", true)).toBe(true);
  expect(await store.read(changed)).toMatchObject({
    outcome: "blocked",
    syncedRevision: 1,
    lastErrorCode: "invalid_schema",
  });
  expect(await store.markSynced(changed, 2)).toBe(true);
});

it("retains synchronized state across reordered object keys and advances for nested changes", async () => {
  const snapshot = await reader.user("user");
  if (snapshot.kind !== "user" || snapshot.deleted) throw new Error("Expected live User snapshot");
  const initial = await store.desire(snapshot);
  await store.markSynced(initial, initial.desiredRevision);
  const synced = await store.read(initial);
  const reordered = {
    memberships: snapshot.memberships.map(({ role, organizationId, userId, id }) => ({
      role,
      organizationId,
      userId,
      id,
    })),
    fields: {
      emailVerified: snapshot.fields.emailVerified,
      registeredAt: snapshot.fields.registeredAt,
      email: snapshot.fields.email,
      name: snapshot.fields.name,
    },
    deleted: snapshot.deleted,
    organizationId: snapshot.organizationId,
    userId: snapshot.userId,
    externalId: snapshot.externalId,
    sourceId: snapshot.sourceId,
    kind: snapshot.kind,
  };
  expect(await store.desire(reordered)).toEqual(synced);

  const renamed = { ...reordered, fields: { ...reordered.fields, name: "Changed" } };
  const changed = await store.desire(renamed);
  expect(changed).toMatchObject({
    desiredRevision: 2,
    syncedRevision: 1,
    lastSuccessAt: synced!.lastSuccessAt,
    outcome: "pending",
  });
  expect(await store.desire({ ...renamed, memberships: [...renamed.memberships] })).toEqual(
    changed,
  );
  expect(
    await store.desire({
      ...renamed,
      memberships: renamed.memberships.map((membership, index) =>
        index === 0 ? { ...membership, role: "admin" } : membership,
      ),
    }),
  ).toMatchObject({ desiredRevision: 3, syncedRevision: 1, outcome: "pending" });
});

it.each(["user", "organization"] as const)(
  "retains entity and relationship cleanup identities after %s deletion",
  async (kind) => {
    const person = await store.desire(await reader.user("user"));
    const company = await store.desire(await reader.organization("pro"));
    const relation = await store.desire(await reader.membership("user", "pro"));
    await store.bindRemote(person, { remoteId: "contact-1" });
    await store.bindRemote(company, { remoteId: "company-1" });
    await store.bindRemote(relation, {
      remoteContactId: "contact-1",
      remoteCompanyId: "company-1",
    });
    const stale = kind === "user" ? person.desired : company.desired;
    if (kind === "user") await fixture.db.delete(user).where(eq(user.id, "user"));
    else await fixture.db.delete(organization).where(eq(organization.id, "pro"));
    expect(await fixture.db.select().from(crmProjection)).toHaveLength(3);
    const tombstone = await store.desire(
      kind === "user" ? await reader.user("user") : await reader.organization("pro"),
    );
    expect(tombstone).toMatchObject({
      desired: { deleted: true },
      deletedAt: expect.any(Date),
      desiredRevision: 2,
      remoteId: kind === "user" ? "contact-1" : "company-1",
    });
    expect(tombstone.desired).not.toHaveProperty("fields");
    const removed = await store.desire(await reader.membership("user", "pro"));
    expect(removed).toMatchObject({
      userId: "user",
      organizationId: "pro",
      remoteContactId: "contact-1",
      remoteCompanyId: "company-1",
      deletedAt: expect.any(Date),
      desired: { deleted: true },
    });
    expect(await store.desire(stale)).toMatchObject({
      deletedAt: tombstone.deletedAt,
      desiredRevision: 2,
      desired: { deleted: true },
    });
    // An old in-flight create result must still be retained after a deletion won.
    await expect(
      store.bindRemote(tombstone, { remoteId: tombstone.remoteId! }),
    ).resolves.toMatchObject({ desiredRevision: 2 });
    expect(await store.markSynced(tombstone, 1)).toBe(false);
    expect(await store.markSynced(tombstone, 2)).toBe(true);
    expect((await store.read(tombstone))!.deletedAt).toEqual(tombstone.deletedAt);
  },
);

it("models membership removal and re-addition independently from source membership row IDs", async () => {
  const initial = await store.desire(await reader.membership("user", "pro"));
  await fixture.db.delete(member).where(eq(member.id, "member-pro"));
  const removed = await store.desire(await reader.membership("user", "pro"));
  expect(removed).toMatchObject({ desiredRevision: 2, desired: { deleted: true } });
  await fixture.db.insert(member).values({
    id: "new-row",
    userId: "user",
    organizationId: "pro",
    role: "owner",
    createdAt: joined,
  });
  const added = await store.desire(await reader.membership("user", "pro"));
  expect(added).toMatchObject({
    externalId: initial.externalId,
    desiredRevision: 3,
    deletedAt: null,
    desired: { deleted: false },
  });
  expect(await store.markSynced(initial, 1)).toBe(false);
});

it("enforces namespace ownership and non-reassignable remote mappings", async () => {
  const snapshot = await reader.user("user");
  await expect(
    createCrmProjectionStore(fixture.db as unknown as Database, "other").desire(snapshot),
  ).rejects.toThrow("identity mismatch");
  const row = await store.desire(snapshot);
  await store.bindRemote(row, { remoteId: "contact-1" });
  await expect(store.bindRemote(row, { remoteId: "different" })).rejects.toThrow(
    "identity conflict",
  );
  await expect(store.bindRemote(row, { remoteCompanyId: "company-1" })).rejects.toThrow(
    "kind mismatch",
  );
  await expect(store.markFailed(row, 1, "provider response with personal data")).rejects.toThrow(
    "failure code",
  );
  expect(getTableConfig(crmProjection).foreignKeys).toHaveLength(0);
});

it("guards retry reservations and refunds against stale counts, revisions and success", async () => {
  const row = await store.desire(await reader.user("user"));
  expect(await store.setRetryFailures(row, 1, 0, 1)).toBe(true);
  expect(await store.setRetryFailures(row, 1, 0, 1)).toBe(false);
  expect(await store.setRetryFailures(row, 1, 1, 0)).toBe(true);
  expect(await store.setRetryFailures(row, 1, 0, 7)).toBe(true);
  expect((await store.desire(await reader.user("user"))).retryFailures).toBe(7);
  await fixture.db.update(user).set({ name: "Changed" }).where(eq(user.id, "user"));
  expect(await store.desire(await reader.user("user"))).toMatchObject({
    desiredRevision: 2,
    retryFailures: 0,
  });
  expect(await store.setRetryFailures(row, 1, 7, 6)).toBe(false);
  expect(await store.setRetryFailures(row, 2, 0, 1)).toBe(true);
  expect(await store.markSynced(row, 2)).toBe(true);
  expect((await store.read(row))?.retryFailures).toBe(0);
  expect(await store.setRetryFailures(row, 2, 0, 1)).toBe(false);
  await expect(store.setRetryFailures(row, 2, 0, -1)).rejects.toThrow("retry allowance");
});
