// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "@everr/app/db/client";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, it } from "vite-plus/test";
import { upgradeLegacyCloudDatabase } from "./legacy-migrations";

const folders = {
  legacyMigrationsFolder: resolve(import.meta.dirname, "../drizzle-legacy"),
  appMigrationsFolder: fileURLToPath(
    new URL("../", import.meta.resolve("@everr/app/migrations/journal")),
  ),
  cloudMigrationsFolder: resolve(import.meta.dirname, "../drizzle"),
};

it("preserves existing billing data and adopts only the baselines before running future migrations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "everr-legacy-upgrade-"));
  const client = new PGlite();
  const db = drizzle(client);
  try {
    const previous = join(directory, "previous");
    cpSync(folders.legacyMigrationsFolder, previous, { recursive: true });
    const journalPath = join(previous, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries.pop();
    writeFileSync(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: previous });
    await client.exec(`
      INSERT INTO organization (id, name, slug, created_at, plan, polar_customer_id)
      VALUES ('paid', 'Paid', 'paid', now(), 'pro', 'customer-paid'),
             ('free', 'Free', 'free', now(), 'hobby', null);
      INSERT INTO org_subscription
        (org_id, polar_subscription_id, polar_product_id, status, polar_modified_at)
      VALUES ('paid', 'subscription-paid', 'product-pro', 'active', now());
      INSERT INTO pro_organization_checkout
        (org_id, owner_id, organization_name, organization_slug, checkout_id, polar_customer_id)
      VALUES ('pending', 'owner', 'Pending', 'pending', 'checkout-pending', 'customer-pending');
    `);

    const appFolder = join(directory, "app");
    cpSync(folders.appMigrationsFolder, appFolder, { recursive: true });
    const appJournalPath = join(appFolder, "meta/_journal.json");
    const appJournal = JSON.parse(readFileSync(appJournalPath, "utf8"));
    appJournal.entries.push({
      idx: 1,
      version: "7",
      when: appJournal.entries[0].when + 1,
      tag: "0001_future",
      breakpoints: true,
    });
    writeFileSync(appJournalPath, JSON.stringify(appJournal));
    writeFileSync(
      join(appFolder, "0001_future.sql"),
      "CREATE TABLE migration_future_check (id integer);",
    );
    const upgradeFolders = { ...folders, appMigrationsFolder: appFolder };
    await upgradeLegacyCloudDatabase(db as unknown as Database, upgradeFolders);
    await upgradeLegacyCloudDatabase(db as unknown as Database, upgradeFolders);
    expect(
      (
        await client.query(
          "SELECT org_id, plan, polar_customer_id FROM organization_billing ORDER BY org_id",
        )
      ).rows,
    ).toEqual([
      { org_id: "free", plan: "hobby", polar_customer_id: null },
      { org_id: "paid", plan: "pro", polar_customer_id: "customer-paid" },
    ]);
    expect((await client.query("SELECT polar_subscription_id FROM org_subscription")).rows).toEqual(
      [{ polar_subscription_id: "subscription-paid" }],
    );
    expect((await client.query("SELECT checkout_id FROM pro_organization_checkout")).rows).toEqual([
      { checkout_id: "checkout-pending" },
    ]);
    expect(
      (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name = 'organization' AND column_name IN ('plan', 'polar_customer_id')",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (await client.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows,
    ).toEqual([{ count: 15 }]);
    await migrate(db, {
      migrationsFolder: appFolder,
      migrationsTable: "__drizzle_migrations",
    });
    await migrate(db, {
      migrationsFolder: folders.cloudMigrationsFolder,
      migrationsTable: "__everr_cloud_migrations",
    });
    expect(
      (await client.query("SELECT to_regclass('migration_future_check') AS name")).rows,
    ).toEqual([{ name: "migration_future_check" }]);
  } finally {
    await client.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

it.each([true, false])(
  "supports app/cloud switching with an existing app database: %s",
  async (appFirst) => {
    const client = new PGlite();
    const db = drizzle(client);
    const appConfig = { migrationsFolder: folders.appMigrationsFolder };
    const cloudConfig = {
      migrationsFolder: folders.cloudMigrationsFolder,
      migrationsTable: "__everr_cloud_migrations",
    };
    try {
      if (appFirst) await migrate(db, appConfig);
      await upgradeLegacyCloudDatabase(db as unknown as Database, folders);
      await migrate(db, appConfig);
      await migrate(db, cloudConfig);
      await client.exec(`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES ('switch', 'Switch', 'switch', now());
      INSERT INTO organization_billing (org_id, plan, polar_customer_id)
      VALUES ('switch', 'pro', 'customer-switch');
    `);
      await migrate(db, appConfig);
      await upgradeLegacyCloudDatabase(db as unknown as Database, folders);
      await migrate(db, appConfig);
      await migrate(db, cloudConfig);
      expect(
        (await client.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations"))
          .rows,
      ).toEqual([{ count: 1 }]);
      expect(
        (await client.query("SELECT count(*)::int AS count FROM drizzle.__everr_cloud_migrations"))
          .rows,
      ).toEqual([{ count: 1 }]);
      expect(
        (await client.query("SELECT org_id, plan, polar_customer_id FROM organization_billing"))
          .rows,
      ).toEqual([{ org_id: "switch", plan: "pro", polar_customer_id: "customer-switch" }]);
    } finally {
      await client.close();
    }
  },
  30_000,
);
