// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({
  get db() {
    return state.db;
  },
}));

import { listApiKeys } from "./api-keys";

const client = new PGlite();
state.db = drizzle(client);
afterAll(() => client.close());

it("lists both configurations only for the active org and never returns secret hashes or metadata", async () => {
  await client.exec(`
    CREATE TABLE apikey (
      id text, config_id text, name text, start text, prefix text,
      reference_id text, key text, enabled boolean,
      created_at timestamp, expires_at timestamp, last_request timestamp,
      permissions text, metadata text
    );
    INSERT INTO apikey (id, config_id, reference_id, key, permissions, metadata) VALUES
      ('public', 'public', 'test_org', 'pk_full_value', '{"ingest":["write"]}', '{"allowedOrigins":["https://example.com"]}'),
      ('secret', 'secret', 'test_org', 'secret_hash', '{"apply":["read"]}', '{"publicKey":"must_not_leak"}'),
      ('other', 'public', 'other_org', 'pk_other_org', NULL, NULL),
      ('legacy', 'ingest', 'test_org', 'legacy_hash', NULL, NULL);
  `);
  const keys = await listApiKeys();
  expect(keys).toHaveLength(2);
  expect(keys.find((key) => key.id === "public")).toMatchObject({
    publicKey: "pk_full_value",
    permissions: { ingest: ["write"] },
    metadata: { allowedOrigins: ["https://example.com"] },
  });
  expect(keys.find((key) => key.id === "secret")).toMatchObject({
    publicKey: null,
    metadata: null,
  });
  for (const key of keys) expect(key).not.toHaveProperty("key");
  expect(JSON.stringify(keys)).not.toMatch(
    /secret_hash|must_not_leak|pk_other_org|legacy_hash/,
  );
});
