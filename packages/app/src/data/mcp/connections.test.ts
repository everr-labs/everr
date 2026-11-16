import { isNotFound } from "@tanstack/react-router";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  organization,
  user,
} from "#app/db/schema/index.ts";
import {
  createTestDatabase,
  type TestDatabase,
} from "#app/server/alerting/testing/pglite-database.ts";

const mocks = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("#app/db/client.ts", () => ({
  get db() {
    return mocks.database;
  },
}));

// The test setup signs every server function in as "test_user".
import { listMcpConnections, revokeMcpConnection } from "./connections";

let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await createTestDatabase();
  mocks.database = fixture.db;
}, 30_000);
afterAll(async () => fixture?.close());

const scopes = ["observability:read", "offline_access"];

beforeEach(async () => {
  await fixture.truncate();
  await fixture.db.insert(user).values([
    { id: "test_user", name: "Test", email: "test@example.test", emailVerified: true },
    { id: "other_user", name: "Other", email: "other@example.test", emailVerified: true },
  ]);
  await fixture.db
    .insert(organization)
    .values({ id: "org", name: "Acme", slug: "acme", createdAt: new Date() });
  await fixture.db.insert(oauthClient).values([
    {
      id: "c1",
      clientId: "claude",
      name: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    },
    { id: "c2", clientId: "cli", name: null, redirectUris: ["http://127.0.0.1:3118/callback"] },
  ]);
  await fixture.db.insert(oauthConsent).values([
    {
      id: "mine",
      clientId: "claude",
      userId: "test_user",
      referenceId: "org",
      scopes,
      createdAt: new Date("2026-11-01T10:00:00Z"),
    },
    { id: "theirs", clientId: "claude", userId: "other_user", referenceId: "org", scopes },
  ]);
  await fixture.db.insert(oauthRefreshToken).values([
    {
      id: "r-mine",
      token: "t1",
      clientId: "claude",
      userId: "test_user",
      referenceId: "org",
      scopes,
    },
    { id: "r-cli", token: "t2", clientId: "cli", userId: "test_user", referenceId: "org", scopes },
    {
      id: "r-theirs",
      token: "t3",
      clientId: "claude",
      userId: "other_user",
      referenceId: "org",
      scopes,
    },
  ]);
});

async function revokedTokens() {
  const rows = await fixture.db
    .select({ id: oauthRefreshToken.id, revoked: oauthRefreshToken.revoked })
    .from(oauthRefreshToken);
  return rows.filter((row) => row.revoked !== null).map((row) => row.id);
}

it("lists only the session user's connections, with destination and organization", async () => {
  expect(await listMcpConnections()).toEqual([
    {
      consentId: "mine",
      clientId: "claude",
      clientName: "Claude",
      destination: { kind: "app", address: "claude.ai" },
      organization: { id: "org", name: "Acme" },
      scopes,
      connectedAt: new Date("2026-11-01T10:00:00Z"),
    },
  ]);
});

it("revokes the consent and that client's refresh tokens, leaving others alone", async () => {
  await revokeMcpConnection({ data: { consentId: "mine" } });

  expect(await listMcpConnections()).toEqual([]);
  expect(await revokedTokens()).toEqual(["r-mine"]);
});

it("rejects another user's consent id and changes nothing", async () => {
  const error = await revokeMcpConnection({ data: { consentId: "theirs" } }).catch((e) => e);

  expect(isNotFound(error)).toBe(true);
  const consents = await fixture.db.select({ id: oauthConsent.id }).from(oauthConsent);
  expect(consents.map((row) => row.id).sort()).toEqual(["mine", "theirs"]);
  expect(await revokedTokens()).toEqual([]);
});
