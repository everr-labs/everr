// @vitest-environment node

import { createHash } from "node:crypto";
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
  await fixture.db
    .insert(user)
    .values({ id: "member", name: "Member", email: "member@example.test", emailVerified: true });
  await fixture.db.insert(organization).values({
    id: "org",
    name: "Workspace",
    slug: "workspace",
    createdAt: now,
  });
  await fixture.db.insert(member).values({
    id: "member-membership",
    organizationId: "org",
    userId: "member",
    role: "member",
    createdAt: now,
  });
  await fixture.db.insert(session).values({
    id: "member-session",
    userId: "member",
    token: "member-session-token",
    activeOrganizationId: "org",
    expiresAt: new Date(now.getTime() + 60_000),
  });
}, 30_000);

afterAll(async () => fixture?.close());

it("authorizes an MCP client without a client-resource link", async () => {
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
    "SELECT client_id FROM oauth_client_resource WHERE client_id = $1",
    [clientId],
  );
  expect(link.rows).toHaveLength(0);

  const verifier = "a".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "http://127.0.0.1:1234/callback",
    response_type: "code",
    scope: "openid offline_access observability:read",
    resource: "http://localhost:3000/mcp",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const headers = new Headers({
    authorization: "Bearer member-session-token",
    origin: "http://localhost:3000",
    accept: "application/json",
  });
  const authorization = await auth.handler(
    new Request(`http://localhost:3000/api/auth/oauth2/authorize?${query}`, { headers }),
  );
  expect(authorization.status, await authorization.clone().text()).toBe(200);
  const authorizationBody = (await authorization.json()) as { url: string };
  const consentURL = new URL(authorizationBody.url, "http://localhost:3000");
  expect(consentURL.pathname).toBe("/mcp/consent");
  const oauthQuery = consentURL.search.slice(1);
  expect(oauthQuery).toBeTruthy();
  const consent = await auth.api.oauth2Consent({
    headers,
    request: new Request("http://localhost:3000/api/auth/oauth2/consent", {
      method: "POST",
      headers,
    }),
    asResponse: false,
    body: { accept: true, oauth_query: oauthQuery },
  });
  expect(consent.url, JSON.stringify(consent)).toBeTruthy();
  const code = new URL(consent.url!).searchParams.get("code");
  expect(code).toBeTruthy();

  const tokenResponse = await auth.handler(
    new Request("http://localhost:3000/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: code!,
        redirect_uri: "http://127.0.0.1:1234/callback",
        code_verifier: verifier,
        resource: "http://localhost:3000/mcp",
      }),
    }),
  );
  expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200);
  const token = await tokenResponse.json();
  expect(token.refresh_token).toBeTruthy();
  const claims = JSON.parse(Buffer.from(token.access_token.split(".")[1], "base64url").toString());
  expect(claims).toMatchObject({ sub: "member", org_id: "org" });
  expect(claims.aud).toContain("http://localhost:3000/mcp");
  expect(claims.scope.split(" ")).toContain("observability:read");

  const refreshed = await auth.handler(
    new Request("http://localhost:3000/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: token.refresh_token,
      }),
    }),
  );
  expect(refreshed.status, await refreshed.clone().text()).toBe(200);
  const refreshedToken = await refreshed.json();
  const refreshedClaims = JSON.parse(
    Buffer.from(refreshedToken.access_token.split(".")[1], "base64url").toString(),
  );
  expect(refreshedClaims).toMatchObject({
    sub: "member",
    org_id: "org",
  });
  expect(refreshedClaims.aud).toContain("http://localhost:3000/mcp");
}, 30_000);

it("accepts only the configured resource in dynamic registration", async () => {
  const register = (resource: string) =>
    auth.handler(
      new Request("http://localhost:3000/api/auth/oauth2/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["http://127.0.0.1:1234/callback"],
          token_endpoint_auth_method: "none",
          resources: [resource],
        }),
      }),
    );

  const allowed = await register("http://localhost:3000/mcp");
  expect(allowed.status, await allowed.clone().text()).toBe(201);
  const rejected = await register("http://localhost:3000/other");
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toMatchObject({ error: "invalid_target" });
});
