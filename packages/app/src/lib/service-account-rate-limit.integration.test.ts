import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;

// A tiny allowance and a short window keep the test at a handful of
// statements. The production numbers live on the route; what is under test
// here is what the counter does at its edges, which is the same at any size.
const LIMIT = { windowMs: 400, max: 3 };
const ACCOUNT_USER_ID = "it-sa-user";

describe.skipIf(!databaseUrl)("the exchange allowance on a secret", () => {
  const load = async () => {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const schema = await import("@/db/schema");
    const pool = new Pool({ connectionString: databaseUrl });
    vi.resetModules();
    vi.doMock("@/db/client", () => ({ db: drizzle(pool, { schema }) }));
    const store = await import("./service-account-store");
    return { pool, store };
  };

  let loaded: Awaited<ReturnType<typeof load>> | undefined;

  const ctx = async () => {
    if (!loaded) loaded = await load();
    return loaded;
  };

  const seedSecret = async (secretId: string) => {
    const { pool } = await ctx();
    await pool.query(
      `INSERT INTO service_account_secret
         (id, service_account_id, hash, start)
       VALUES ($1, 'it-sa', $1, 'sa_it')`,
      [secretId],
    );
    return secretId;
  };

  beforeEach(async () => {
    const { pool } = await ctx();
    await pool.query("DELETE FROM service_account WHERE id = 'it-sa'");
    await pool.query(`DELETE FROM "user" WHERE id = $1`, [ACCOUNT_USER_ID]);
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, 'it', $2)`,
      [ACCOUNT_USER_ID, `${ACCOUNT_USER_ID}@svc.everr.invalid`],
    );
    await pool.query(
      "INSERT INTO service_account (id, user_id) VALUES ('it-sa', $1)",
      [ACCOUNT_USER_ID],
    );
  });

  afterAll(async () => {
    if (!loaded) return;
    await loaded.pool
      .query("DELETE FROM service_account WHERE id = 'it-sa'")
      .catch(() => {});
    await loaded.pool
      .query(`DELETE FROM "user" WHERE id = $1`, [ACCOUNT_USER_ID])
      .catch(() => {});
    vi.doUnmock("@/db/client");
    vi.resetModules();
    await loaded.pool.end();
  });

  it("lets a secret exchange while it is under the limit", async () => {
    const { store } = await ctx();
    const secret = await seedSecret("it-secret-under");

    for (let attempt = 0; attempt < LIMIT.max; attempt += 1) {
      expect(await store.consumeExchangeAllowance(secret, LIMIT)).toBe(true);
    }
  });

  it("refuses the same secret once it is over the limit", async () => {
    const { store } = await ctx();
    const secret = await seedSecret("it-secret-over");

    for (let attempt = 0; attempt < LIMIT.max; attempt += 1) {
      await store.consumeExchangeAllowance(secret, LIMIT);
    }

    expect(await store.consumeExchangeAllowance(secret, LIMIT)).toBe(false);
    expect(await store.consumeExchangeAllowance(secret, LIMIT)).toBe(false);
  });

  it("lets the same secret exchange again once the window has passed", async () => {
    const { store } = await ctx();
    const secret = await seedSecret("it-secret-window");

    for (let attempt = 0; attempt < LIMIT.max; attempt += 1) {
      await store.consumeExchangeAllowance(secret, LIMIT);
    }
    expect(await store.consumeExchangeAllowance(secret, LIMIT)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, LIMIT.windowMs + 50));

    expect(await store.consumeExchangeAllowance(secret, LIMIT)).toBe(true);
  });

  it("keeps one secret's limit off another secret", async () => {
    const { store } = await ctx();
    const busy = await seedSecret("it-secret-busy");
    const quiet = await seedSecret("it-secret-quiet");

    for (let attempt = 0; attempt <= LIMIT.max; attempt += 1) {
      await store.consumeExchangeAllowance(busy, LIMIT);
    }

    expect(await store.consumeExchangeAllowance(busy, LIMIT)).toBe(false);
    expect(await store.consumeExchangeAllowance(quiet, LIMIT)).toBe(true);
  });

  it("hands the last unit of the allowance to one exchange only", async () => {
    // The point of doing this in one statement: exchanges that arrive
    // together must not both read the same count and both pass.
    const { store } = await ctx();
    const secret = await seedSecret("it-secret-concurrent");

    const together = 8;
    const results = await Promise.all(
      Array.from({ length: together }, () =>
        store.consumeExchangeAllowance(secret, { windowMs: 60_000, max: 1 }),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
