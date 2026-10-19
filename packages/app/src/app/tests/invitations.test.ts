// @vitest-environment node

import type { PoolClient } from "pg";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createInstallationIdentity } from "#app/app/identity.ts";
import { setupWorkspace } from "#app/app/installation.server.ts";
import { createWorkspaceIdentityRequests } from "#app/app/request.ts";
import { createApplicationAuth } from "#app/identity/module.ts";
import { createAuthTestDatabase } from "#app/identity/testing/database.ts";

const state = {
  verificationUrl: "",
  lockQuery: vi.fn(),
  releaseLock: vi.fn(),
};
const { client, database } = await createAuthTestDatabase();
afterAll(() => client.close());
beforeEach(async () => {
  state.verificationUrl = "";
  state.lockQuery.mockReset().mockResolvedValue({ rows: [{ locked: true }] });
  state.releaseLock.mockReset();
  await client.exec(
    'TRUNCATE "user", account, organization, member, invitation, session, verification CASCADE',
  );
});
function createAuth(emailEnabled = false) {
  const requests = createWorkspaceIdentityRequests({
    connect: async () =>
      ({
        query: state.lockQuery,
        release: state.releaseLock,
      }) as unknown as PoolClient,
  });
  return createApplicationAuth(createInstallationIdentity(database, requests), {
    database,
    baseURL: "http://localhost:3000",
    secret: "invitation-integration-test-secret-long-enough",
    email: {
      enabled: emailEnabled,
      sendInvitation() {},
      sendPasswordReset() {},
      sendVerification: ({ url }) => {
        state.verificationUrl = url;
      },
    },
    canInviteMembers: async () => true,
  });
}
const input = {
  workspaceName: "Acme",
  name: "Owner",
  email: "owner@example.test",
  password: "long-test-password",
};

it.each([
  false,
  true,
])("replaces invitations and enforces signup and verification with email enabled: %s", async (emailEnabled) => {
  const auth = createAuth(emailEnabled);
  const { organizationId } = await setupWorkspace(input, database);
  const owner = await auth.api.signInEmail({ body: input, asResponse: true });
  const headers = new Headers({
    cookie: owner.headers.get("set-cookie") ?? "",
  });
  const recipient = {
    name: "Recipient",
    email: "recipient@example.test",
    password: "recipient-test-password",
  };
  const body = { email: recipient.email, role: "member", organizationId };
  const first = await auth.api.createInvitation({ headers, body });
  const replacement = await auth.api.createInvitation({ headers, body });
  await expect(
    auth.api.signUpEmail({
      body: { ...recipient, callbackURL: `/invite/${first.id}` },
    }),
  ).rejects.toThrow("invitation");
  const forgedVerification = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ ...recipient, emailVerified: true }),
    }),
  );
  expect(forgedVerification.status).toBe(403);
  const response = await auth.api.signUpEmail({
    body: { ...recipient, callbackURL: `/invite/${replacement.id}` },
    asResponse: true,
  });
  let inviteeHeaders = new Headers({
    cookie: response.headers.get("set-cookie") ?? "",
  });
  const accept = (invitationId: string) =>
    auth.api.acceptInvitation({
      headers: inviteeHeaders,
      body: { invitationId },
    });
  await expect(accept(first.id)).rejects.toThrow();
  if (emailEnabled) {
    await expect(accept(replacement.id)).rejects.toThrow("verification");
    const token = new URL(state.verificationUrl).searchParams.get("token");
    if (!token) throw new Error("Missing verification token");
    const verified = await auth.api.verifyEmail({
      query: { token },
      asResponse: true,
    });
    inviteeHeaders = new Headers({
      cookie: verified.headers.get("set-cookie") ?? "",
    });
  }
  await expect(accept(replacement.id)).resolves.toBeTruthy();
});

it.each([
  {
    name: "removing a Member",
    path: "organization/remove-member",
    email: "recipient@example.test",
    allowed: true,
  },
  {
    name: "removing the last Owner",
    path: "organization/remove-member",
    email: "owner@example.test",
    allowed: false,
  },
  {
    name: "deleting the last Owner account",
    path: "delete-user",
    email: undefined,
    allowed: false,
  },
])("holds and releases identity locks when $name", async ({
  path,
  email,
  allowed,
}) => {
  const auth = createAuth();
  const { organizationId } = await setupWorkspace(input, database);
  await client.exec(
    `INSERT INTO "user" (id, name, email) VALUES ('recipient', 'Recipient', 'recipient@example.test')`,
  );
  await client.query(
    "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('recipient-member', $1, 'recipient', 'member', now())",
    [organizationId],
  );
  const owner = await auth.api.signInEmail({ body: input, asResponse: true });
  const headers = {
    cookie: owner.headers.get("set-cookie") ?? "",
    "content-type": "application/json",
    origin: "http://localhost:3000",
  };
  if (path === "delete-user") {
    await expect(
      auth.api.createOrganization({
        body: { name: "Another", slug: "another", userId: "recipient" },
      }),
    ).rejects.toThrow("one workspace");
    const deletion = await auth.handler(
      new Request("http://localhost:3000/api/auth/organization/delete", {
        method: "POST",
        headers,
        body: JSON.stringify({ organizationId }),
      }),
    );
    expect(deletion.status).toBe(403);
    expect(await deletion.json()).toMatchObject({
      message: "The installation workspace cannot be deleted.",
    });
    expect(
      (await client.query("SELECT id FROM organization")).rows,
    ).toHaveLength(1);
  }
  let membersAtUnlock: number | undefined;
  state.lockQuery.mockImplementation(async (sql: string) => {
    expect(state.releaseLock).not.toHaveBeenCalled();
    if (sql.includes("pg_advisory_unlock")) {
      membersAtUnlock = (await client.query("SELECT id FROM member")).rows
        .length;
    }
    return { rows: [{ locked: true }] };
  });
  const response = await auth.handler(
    new Request(`http://localhost:3000/api/auth/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(
        email
          ? { organizationId, memberIdOrEmail: email }
          : { password: input.password },
      ),
    }),
  );
  expect(response.ok).toBe(allowed);
  expect(membersAtUnlock).toBe(allowed ? 1 : 2);
  expect(state.lockQuery).toHaveBeenCalledTimes(2);
  expect(state.releaseLock).toHaveBeenCalledOnce();
  if (path === "delete-user") {
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining(
        "Transfer ownership before deleting your account.",
      ),
    });
    expect((await client.query('SELECT id FROM "user"')).rows).toHaveLength(2);
  }
});

it("owns account deletion checks and locks without exposing a request protocol to callers", async () => {
  const auth = createAuth();
  await setupWorkspace(input, database);
  const owner = await auth.api.signInEmail({ body: input, asResponse: true });
  const headers = new Headers({
    cookie: owner.headers.get("set-cookie") ?? "",
  });
  await expect(auth.deleteAccount({ headers })).rejects.toMatchObject({
    status: "FORBIDDEN",
    message: expect.stringContaining("only owner"),
  });
  expect(state.lockQuery).toHaveBeenCalledTimes(2);
  expect(state.releaseLock).toHaveBeenCalledOnce();
  expect((await client.query('SELECT id FROM "user"')).rows).toHaveLength(1);
});
