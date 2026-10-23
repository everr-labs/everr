// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "@everr/app/db/database";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vite-plus/test";
import { crmBrevoBudget } from "../../db/schema/crm";
import { createBrevoBudget } from "./budget";

const client = new PGlite();
const database = drizzle(client) as unknown as Database;
const replicaA = createBrevoBudget(database, "same-brevo-account");
const replicaB = createBrevoBudget(database, "same-brevo-account");
beforeAll(async () => {
  await client.exec(
    "CREATE TABLE crm_brevo_budget (account_scope text NOT NULL, endpoint_group text NOT NULL CHECK (endpoint_group IN ('contacts','general')), next_allowed_at timestamptz NOT NULL, PRIMARY KEY (account_scope, endpoint_group))",
  );
});
beforeEach(async () => {
  await client.exec("TRUNCATE crm_brevo_budget");
});
afterAll(async () => {
  await client.close();
});

it("atomically admits one of competing replicas and denied attempts never extend the budget", async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) => (i % 2 ? replicaA : replicaB).acquire("general")),
  );
  expect(results.filter((result) => result.allowed)).toHaveLength(1);
  const [before] = await database.select().from(crmBrevoBudget);
  expect(await replicaB.acquire("general")).toEqual({
    allowed: false,
    retryAt: before.nextAllowedAt,
  });
  const [after] = await database.select().from(crmBrevoBudget);
  expect(after.nextAllowedAt).toEqual(before.nextAllowedAt);
  const clock = await client.query<{ remaining: number }>(
    "SELECT extract(epoch from (next_allowed_at-clock_timestamp()))*1000 AS remaining FROM crm_brevo_budget",
  );
  expect(Number(clock.rows[0].remaining)).toBeGreaterThan(35_000);
  expect(Number(clock.rows[0].remaining)).toBeLessThanOrEqual(36_000);
});

it("uses shared DB time, keeps contact/general budgets separate, and releases expired permits", async () => {
  expect(await replicaA.acquire("contacts")).toEqual({ allowed: true });
  expect(await replicaB.acquire("general")).toEqual({ allowed: true });
  const independentAccount = createBrevoBudget(database, "other-account");
  expect(await independentAccount.acquire("general")).toEqual({ allowed: true });
  await client.exec(
    "UPDATE crm_brevo_budget SET next_allowed_at=clock_timestamp()-interval '1 second'",
  );
  expect(await replicaB.acquire("contacts")).toEqual({ allowed: true });
  const clock = await client.query<{ remaining: number }>(
    "SELECT extract(epoch from (next_allowed_at-clock_timestamp()))*1000 AS remaining FROM crm_brevo_budget WHERE endpoint_group='contacts'",
  );
  expect(Number(clock.rows[0].remaining)).toBeGreaterThan(0);
  expect(Number(clock.rows[0].remaining)).toBeLessThanOrEqual(100);
});

it("shares cooldowns across stores, never shortens them, and retains them across client reconstruction", async () => {
  await replicaA.cooldown("general", 180_000);
  const first = await replicaB.acquire("general");
  expect(first.allowed).toBe(false);
  await replicaB.cooldown("general", 1000);
  expect(await createBrevoBudget(database, "same-brevo-account").acquire("general")).toEqual(first);
  await replicaB.cooldown("general", 360_000);
  const extended = await replicaA.acquire("general");
  expect(extended.allowed).toBe(false);
  expect(!extended.allowed && !first.allowed && extended.retryAt > first.retryAt).toBe(true);
  expect(() => createBrevoBudget(database, " ")).toThrow();
  await expect(replicaA.cooldown("general", NaN)).rejects.toThrow();
});
