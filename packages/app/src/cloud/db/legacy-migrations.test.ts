// @vitest-environment node
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, it } from "vitest";
import type { Database } from "@/db/client";
import { upgradeLegacyCloudDatabase } from "./legacy-migrations";

const folders = {
  legacyMigrationsFolder: resolve("src/cloud/drizzle-legacy"),
  coreMigrationsFolder: resolve("drizzle/core"),
  cloudMigrationsFolder: resolve("src/cloud/drizzle"),
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

    const coreFolder = join(directory, "core");
    cpSync(folders.coreMigrationsFolder, coreFolder, { recursive: true });
    const coreJournalPath = join(coreFolder, "meta/_journal.json");
    const coreJournal = JSON.parse(readFileSync(coreJournalPath, "utf8"));
    coreJournal.entries.push({
      idx: 1,
      version: "7",
      when: coreJournal.entries[0].when + 1,
      tag: "0001_future",
      breakpoints: true,
    });
    writeFileSync(coreJournalPath, JSON.stringify(coreJournal));
    writeFileSync(
      join(coreFolder, "0001_future.sql"),
      "CREATE TABLE migration_future_check (id integer);",
    );
    const upgradeFolders = { ...folders, coreMigrationsFolder: coreFolder };
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
    expect(
      (await client.query("SELECT polar_subscription_id FROM org_subscription"))
        .rows,
    ).toEqual([{ polar_subscription_id: "subscription-paid" }]);
    expect(
      (await client.query("SELECT checkout_id FROM pro_organization_checkout"))
        .rows,
    ).toEqual([{ checkout_id: "checkout-pending" }]);
    expect(
      (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name = 'organization' AND column_name IN ('plan', 'polar_customer_id')",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM drizzle.__everr_core_migrations",
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
    await migrate(db, {
      migrationsFolder: coreFolder,
      migrationsTable: "__everr_core_migrations",
    });
    await migrate(db, {
      migrationsFolder: folders.cloudMigrationsFolder,
      migrationsTable: "__everr_cloud_migrations",
    });
    expect(
      (
        await client.query(
          "SELECT to_regclass('migration_future_check') AS name",
        )
      ).rows,
    ).toEqual([{ name: "migration_future_check" }]);
  } finally {
    await client.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
