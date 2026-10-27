// @vitest-environment node

import type { PoolClient } from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vite-plus/test";
import { createInstallationIdentity } from "#app/app/identity.ts";
import { createWorkspaceIdentityRequests } from "#app/app/request.ts";
import type { Database } from "#app/db/database.ts";
import { member, organization, session, user } from "#app/db/schema/index.ts";
import { createApplicationAuth } from "#app/identity/module.ts";
import {
  createTestDatabase,
  type TestDatabase,
} from "#app/server/alerting/testing/pglite-database.ts";

let fixture: TestDatabase;
let auth: ReturnType<typeof createApplicationAuth>;

beforeAll(async () => {
  fixture = await createTestDatabase();
  const database = fixture.db as unknown as Database;
  const requests = createWorkspaceIdentityRequests({
    connect: async () =>
      ({
        query: vi.fn().mockResolvedValue({ rows: [{ locked: true }] }),
        release: vi.fn(),
      }) as unknown as PoolClient,
  });
  auth = createApplicationAuth(createInstallationIdentity(database, requests), {
    database,
    baseURL: "http://localhost:3000",
    secret: "oauth-resource-test-secret-long-enough",
    email: {
      enabled: false,
      sendInvitation() {},
      sendPasswordReset() {},
      sendVerification() {},
    },
    canInviteMembers: async () => true,
  });

  const now = new Date();
  await fixture.db.insert(user).values([
    { id: "owner", name: "Owner", email: "owner@example.test", emailVerified: true },
    { id: "member", name: "Member", email: "member@example.test", emailVerified: true },
  ]);
  await fixture.db.insert(organization).values({
    id: "org",
    name: "Workspace",
    slug: "workspace",
    createdAt: now,
  });
  await fixture.db.insert(member).values([
    {
      id: "owner-membership",
      organizationId: "org",
      userId: "owner",
      role: "owner",
      createdAt: now,
    },
    {
      id: "member-membership",
      organizationId: "org",
      userId: "member",
      role: "member",
      createdAt: now,
    },
  ]);
  await fixture.db.insert(session).values([
    {
      id: "owner-session",
      userId: "owner",
      token: "owner-session-token",
      activeOrganizationId: "org",
      expiresAt: new Date(now.getTime() + 60_000),
    },
    {
      id: "member-session",
      userId: "member",
      token: "member-session-token",
      activeOrganizationId: "org",
      expiresAt: new Date(now.getTime() + 60_000),
    },
  ]);
}, 30_000);

afterAll(async () => fixture?.close());

it("keeps automatic MCP links while denying user-driven resource administration", async () => {
  const registered = await auth.handler(
    new Request("http://localhost:3000/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "MCP client",
        redirect_uris: ["http://127.0.0.1:1234/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    }),
  );
  expect(registered.status, await registered.clone().text()).toBe(201);
  const { client_id: clientId } = (await registered.json()) as { client_id: string };
  const link = await fixture.client.query(
    "SELECT client_id FROM oauth_client_resource WHERE client_id = $1 AND resource_id = $2",
    [clientId, "http://localhost:3000/mcp"],
  );
  expect(link.rows).toHaveLength(1);

  for (const token of ["member-session-token", "owner-session-token"]) {
    const headers = new Headers({ authorization: `Bearer ${token}` });
    expect((await auth.api.getSession({ headers }))?.user.id).toBe(token.split("-")[0]);
    const update = await auth.api.adminUpdateOAuthResource({
      headers,
      params: { identifier: "http://localhost:3000/mcp" },
      body: { disabled: true },
      asResponse: true,
    });
    expect(update.status, await update.clone().text()).toBe(401);

    const unlink = await auth.api.adminUnlinkClientResource({
      headers,
      params: { identifier: "http://localhost:3000/mcp", client_id: clientId },
      asResponse: true,
    });
    expect(unlink.status).toBe(401);
  }

  const resourceRow = await fixture.client.query(
    "SELECT disabled FROM oauth_resource WHERE identifier = $1",
    ["http://localhost:3000/mcp"],
  );
  expect(resourceRow.rows).toEqual([{ disabled: false }]);
  expect(
    (
      await fixture.client.query(
        "SELECT client_id FROM oauth_client_resource WHERE client_id = $1 AND resource_id = $2",
        [clientId, "http://localhost:3000/mcp"],
      )
    ).rows,
  ).toHaveLength(1);
}, 30_000);
