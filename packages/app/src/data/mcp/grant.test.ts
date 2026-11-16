import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { member, oauthClient, oauthConsent, organization, user } from "#app/db/schema/index.ts";
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

import { assertMcpGrant, McpGrantError } from "./grant";

let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await createTestDatabase();
  mocks.database = fixture.db;
}, 30_000);
afterAll(async () => fixture?.close());

beforeEach(async () => {
  await fixture.truncate();
  const now = new Date();
  await fixture.db.insert(user).values([
    { id: "alice", name: "Alice", email: "alice@example.test", emailVerified: true },
    { id: "bob", name: "Bob", email: "bob@example.test", emailVerified: true },
  ]);
  await fixture.db.insert(organization).values({
    id: "org",
    name: "Org",
    slug: "org",
    createdAt: now,
    metadata: '{"clickhouseReady":true}',
  });
  await fixture.db.insert(member).values({
    id: "m-alice",
    organizationId: "org",
    userId: "alice",
    role: "member",
    createdAt: now,
  });
  await fixture.db.insert(oauthClient).values([
    { id: "c1", clientId: "client-1", redirectUris: ["http://127.0.0.1:1/cb"] },
    { id: "c2", clientId: "client-2", redirectUris: ["http://127.0.0.1:2/cb"] },
  ]);
  await fixture.db.insert(oauthConsent).values([
    {
      id: "consent-alice",
      clientId: "client-1",
      userId: "alice",
      referenceId: "org",
      scopes: ["observability:read"],
    },
    {
      id: "consent-bob",
      clientId: "client-1",
      userId: "bob",
      referenceId: "org",
      scopes: ["observability:read"],
    },
  ]);
});

it("passes a member who consented to this client in this organization", async () => {
  await expect(assertMcpGrant("alice", "org", "client-1")).resolves.toEqual({
    metadata: '{"clickhouseReady":true}',
  });
});

it("rejects a member whose consent was revoked", async () => {
  await fixture.client.query("DELETE FROM oauth_consent WHERE id = 'consent-alice'");
  await expect(assertMcpGrant("alice", "org", "client-1")).rejects.toBeInstanceOf(McpGrantError);
});

it("rejects a member whose consent is for another client", async () => {
  await expect(assertMcpGrant("alice", "org", "client-2")).rejects.toBeInstanceOf(McpGrantError);
});

it("rejects a consenting user who is no longer a member", async () => {
  await expect(assertMcpGrant("bob", "org", "client-1")).rejects.toBeInstanceOf(McpGrantError);
});
