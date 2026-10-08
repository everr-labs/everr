// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { createOnboardingStore } from "./store";

const client = new PGlite();
const database = drizzle(client, { schema });
await client.exec(`
  CREATE TABLE "user" (id text PRIMARY KEY);
  CREATE TABLE organization (id text PRIMARY KEY, name text NOT NULL, metadata text);
  CREATE TABLE member (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id), user_id text NOT NULL REFERENCES "user"(id), role text NOT NULL);
`);
afterAll(() => client.close());
const scope = { userId: "alice", organizationId: "one" };
const store = createOnboardingStore(database as unknown as Database);

beforeEach(async () => {
  await client.exec(`
    TRUNCATE member, organization, "user" CASCADE;
    INSERT INTO "user" VALUES ('alice'), ('bob'), ('outsider');
    INSERT INTO organization (id, name) VALUES ('one', 'First organization'), ('two', 'Second organization');
    INSERT INTO member VALUES ('a1', 'one', 'alice', 'owner'), ('a2', 'two', 'alice', 'member'), ('b1', 'one', 'bob', 'admin');
  `);
});

it("starts incomplete and shares completion between members of only the selected organization", async () => {
  expect((await store.getStatus(scope)).onboardingCompleted).toBe(false);
  expect(await store.complete(scope)).toEqual({ onboardingCompleted: true });
  const reloaded = createOnboardingStore(database as unknown as Database);
  expect(
    (await reloaded.getStatus({ ...scope, userId: "bob" })).onboardingCompleted,
  ).toBe(true);
  expect(
    (await reloaded.getStatus({ ...scope, organizationId: "two" }))
      .onboardingCompleted,
  ).toBe(false);
});

it("rejects nonmembers and revoked members for reads and completion", async () => {
  const outsider = { ...scope, userId: "outsider" };
  await expect(store.getStatus(outsider)).rejects.toThrow("no longer a member");
  await expect(store.complete(outsider)).rejects.toThrow("no longer a member");
  expect((await store.getStatus(scope)).onboardingCompleted).toBe(false);
  await client.exec("DELETE FROM member WHERE id = 'a1'");
  await expect(store.getStatus(scope)).rejects.toThrow("no longer a member");
  await expect(store.complete(scope)).rejects.toThrow("no longer a member");
});

it("offers keys only to admins and owners while allowing other members to finish without keys or telemetry", async () => {
  expect((await store.getStatus(scope)).canCreateKeys).toBe(true);
  expect(
    (await store.getStatus({ ...scope, userId: "bob" })).canCreateKeys,
  ).toBe(true);
  const memberScope = { ...scope, organizationId: "two" };
  expect((await store.getStatus(memberScope)).canCreateKeys).toBe(false);
  expect(await store.complete(memberScope)).toEqual({
    onboardingCompleted: true,
  });
});

it("recognizes completion already saved by the former organization onboarding", async () => {
  await database
    .update(schema.organization)
    .set({
      metadata: JSON.stringify({
        onboardingCompleted: true,
        legacySetting: "preserved",
      }),
    })
    .where(eq(schema.organization.id, scope.organizationId));
  expect((await store.getStatus(scope)).onboardingCompleted).toBe(true);
  expect(
    (await store.getStatus({ ...scope, userId: "bob" })).onboardingCompleted,
  ).toBe(true);
  expect(
    (await store.getStatus({ ...scope, organizationId: "two" }))
      .onboardingCompleted,
  ).toBe(false);
});

it.each([
  null,
  "",
  "null",
  "{}",
  '{"onboardingCompleted":false}',
  '{"onboardingCompleted":"true"}',
])("treats unset or nonboolean completion as incomplete and can complete it (%s)", async (metadata) => {
  await database
    .update(schema.organization)
    .set({ metadata })
    .where(eq(schema.organization.id, scope.organizationId));
  expect((await store.getStatus(scope)).onboardingCompleted).toBe(false);
  expect(await store.complete(scope)).toEqual({ onboardingCompleted: true });
  expect((await store.getStatus(scope)).onboardingCompleted).toBe(true);
});

it("makes completion idempotent and preserves other metadata including changes since Home was loaded", async () => {
  const initialMetadata = {
    onboardingCompleted: false,
    billing: { customer: "existing", flags: ["one", "two"] },
    featureEnabled: true,
  };
  await database
    .update(schema.organization)
    .set({ metadata: JSON.stringify(initialMetadata) })
    .where(eq(schema.organization.id, scope.organizationId));
  await store.getStatus(scope);
  const latestMetadata = {
    ...initialMetadata,
    anotherSetting: { value: "added later" },
  };
  await database
    .update(schema.organization)
    .set({ metadata: JSON.stringify(latestMetadata) })
    .where(eq(schema.organization.id, scope.organizationId));
  await store.complete(scope);
  expect(await store.complete(scope)).toEqual({ onboardingCompleted: true });
  expect(await store.getStatus(scope)).toEqual({
    organizationName: "First organization",
    canCreateKeys: true,
    onboardingCompleted: true,
  });
  const [row] = await database
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, scope.organizationId));
  expect(JSON.parse(row.metadata ?? "null")).toEqual({
    ...latestMetadata,
    onboardingCompleted: true,
  });
});

it("does not hide or overwrite malformed metadata", async () => {
  await database
    .update(schema.organization)
    .set({ metadata: "invalid JSON" })
    .where(eq(schema.organization.id, scope.organizationId));
  await expect(store.getStatus(scope)).rejects.toThrow();
  await expect(store.complete(scope)).rejects.toThrow();
  const [row] = await database
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, scope.organizationId));
  expect(row.metadata).toBe("invalid JSON");
});
