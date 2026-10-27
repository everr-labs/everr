// @vitest-environment node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, it } from "vite-plus/test";

const appMigrations = {
  migrationsFolder: fileURLToPath(
    new URL("../", import.meta.resolve("@everr/app/migrations/journal")),
  ),
};
const cloudMigrations = {
  migrationsFolder: resolve(import.meta.dirname, "../drizzle"),
  migrationsSchema: "drizzle",
  migrationsTable: "__everr_cloud_migrations",
};

it("keeps migration histories and data in separate App and Cloud databases", async () => {
  const appClient = new PGlite();
  const cloudClient = new PGlite();
  const appDb = drizzle(appClient);
  const cloudDb = drizzle(cloudClient);
  try {
    await appClient.query("SELECT set_config('everr.mcp_resource', $1, false)", [
      "https://app.example.test/mcp",
    ]);
    await cloudClient.query("SELECT set_config('everr.mcp_resource', $1, false)", [
      "https://cloud.example.test/mcp",
    ]);
    await migrate(appDb, appMigrations);
    await migrate(cloudDb, appMigrations);
    await migrate(cloudDb, cloudMigrations);

    await appClient.exec(`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES ('app', 'App', 'app', now());
    `);
    await cloudClient.exec(`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES ('cloud', 'Cloud', 'cloud', now());
      INSERT INTO organization_billing (org_id, plan, polar_customer_id)
      VALUES ('cloud', 'pro', 'customer-cloud');
    `);

    await migrate(appDb, appMigrations);
    await migrate(cloudDb, appMigrations);
    await migrate(cloudDb, cloudMigrations);

    expect((await appClient.query("SELECT id FROM organization")).rows).toEqual([{ id: "app" }]);
    expect((await appClient.query("SELECT identifier FROM oauth_resource")).rows).toEqual([
      { identifier: "https://app.example.test/mcp" },
    ]);
    expect(
      (await appClient.query("SELECT to_regclass('drizzle.__everr_cloud_migrations') AS name"))
        .rows,
    ).toEqual([{ name: null }]);
    expect((await cloudClient.query("SELECT id FROM organization")).rows).toEqual([
      { id: "cloud" },
    ]);
    expect((await cloudClient.query("SELECT identifier FROM oauth_resource")).rows).toEqual([
      { identifier: "https://cloud.example.test/mcp" },
    ]);
    expect(
      (await cloudClient.query("SELECT org_id, plan, polar_customer_id FROM organization_billing"))
        .rows,
    ).toEqual([{ org_id: "cloud", plan: "pro", polar_customer_id: "customer-cloud" }]);
    expect(
      (
        await cloudClient.query(
          "SELECT count(*)::int AS count FROM drizzle.__everr_cloud_migrations",
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
  } finally {
    await appClient.close();
    await cloudClient.close();
  }
}, 30_000);
