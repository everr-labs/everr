// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, it } from "vite-plus/test";

const migrationsFolder = resolve(import.meta.dirname, "../../drizzle");

it("preserves existing MCP clients and active refresh grants across the 1.7 upgrade", async () => {
  const legacyFolder = await mkdtemp(join(tmpdir(), "everr-oauth-migrations-"));
  const client = new PGlite();
  try {
    await mkdir(join(legacyFolder, "meta"));
    for (const name of ["0000_baseline.sql", "0011_better_auth_1_7.sql"]) {
      await copyFile(join(migrationsFolder, name), join(legacyFolder, name));
    }
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    );
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 2);
    await writeFile(join(legacyFolder, "meta/_journal.json"), JSON.stringify(journal));

    const db = drizzle(client);
    await client.query("SELECT set_config('everr.mcp_resource', $1, false)", [
      "https://app.example.test/mcp",
    ]);
    await migrate(db, { migrationsFolder: legacyFolder });
    await client.exec(`
      INSERT INTO "user" (id, name, email) VALUES ('user', 'User', 'user@example.test');
      INSERT INTO oauth_client (id, client_id, redirect_uris)
      VALUES ('client', 'existing-client', ARRAY['http://localhost/callback']),
             ('other', 'other-client', ARRAY['http://localhost/callback']);
      INSERT INTO oauth_refresh_token
        (id, token, client_id, user_id, scopes, expires_at, revoked, resources)
      VALUES
        ('mcp', 'mcp-token', 'existing-client', 'user', ARRAY['observability:read'], now() + interval '1 day', NULL, NULL),
        ('plain', 'plain-token', 'existing-client', 'user', ARRAY['openid'], now() + interval '1 day', NULL, NULL),
        ('expired', 'expired-token', 'existing-client', 'user', ARRAY['observability:read'], now() - interval '1 day', NULL, NULL),
        ('revoked', 'revoked-token', 'existing-client', 'user', ARRAY['observability:read'], now() + interval '1 day', now(), NULL),
        ('bound', 'bound-token', 'existing-client', 'user', ARRAY['observability:read'], now() + interval '1 day', NULL, ARRAY['https://other.example.test/resource']);
    `);

    await migrate(db, { migrationsFolder });
    await migrate(db, { migrationsFolder });

    expect((await client.query("SELECT identifier FROM oauth_resource")).rows).toEqual([
      { identifier: "https://app.example.test/mcp" },
    ]);
    expect(
      (
        await client.query(
          "SELECT client_id, resource_id FROM oauth_client_resource ORDER BY client_id",
        )
      ).rows,
    ).toEqual([
      { client_id: "existing-client", resource_id: "https://app.example.test/mcp" },
      { client_id: "other-client", resource_id: "https://app.example.test/mcp" },
    ]);
    expect(
      (await client.query("SELECT id, resources FROM oauth_refresh_token ORDER BY id")).rows,
    ).toEqual([
      { id: "bound", resources: ["https://other.example.test/resource"] },
      { id: "expired", resources: null },
      { id: "mcp", resources: ["https://app.example.test/mcp"] },
      { id: "plain", resources: null },
      { id: "revoked", resources: null },
    ]);
  } finally {
    await client.close();
    await rm(legacyFolder, { recursive: true, force: true });
  }
}, 30_000);
