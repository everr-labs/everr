// @vitest-environment node

import type { PoolClient } from "pg";
import { afterAll, beforeEach, expect, it, vi } from "vite-plus/test";
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
    events: { async publish() {} },
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
  { role: "member", visibleRoles: [] },
  { role: "admin", visibleRoles: ["admin", "member", "owner"] },
  { role: "owner", visibleRoles: ["admin", "member", "owner"] },
])("limits invitation visibility for $role", async ({ role, visibleRoles }) => {
  const auth = createAuth();
  const { organizationId } = await setupWorkspace(input, database);
  const owner = await auth.api.signInEmail({ body: input, asResponse: true });
  const ownerHeaders = new Headers({
    cookie: owner.headers.get("set-cookie") ?? "",
  });
  const recipient = {
    name: "Member",
    email: "member@example.test",
    password: "long-member-password",
  };
  const memberInvite = await auth.api.createInvitation({
    headers: ownerHeaders,
    body: { email: recipient.email, role, organizationId },
  });
  const signup = await auth.api.signUpEmail({
    body: { ...recipient, callbackURL: `/invite/${memberInvite.id}` },
    asResponse: true,
  });
  const headers = new Headers({
    cookie: signup.headers.get("set-cookie") ?? "",
  });
  await auth.api.acceptInvitation({
    headers,
    body: { invitationId: memberInvite.id },
  });
  for (const invitedRole of ["member", "admin", "owner"]) {
    await auth.api.createInvitation({
      headers: ownerHeaders,
      body: {
        email: `${invitedRole}@future.example.test`,
        role: invitedRole,
        organizationId,
      },
    });
  }
  for (const query of ["", `?organizationId=${organizationId}`, "?organizationSlug=workspace"]) {
    const response = await auth.handler(
      new Request(`http://localhost:3000/api/auth/organization/get-full-organization${query}`, {
        headers,
      }),
    );
    expect(response.status).toBe(200);
    const organization = await response.json();
    expect(organization.id).toBe(organizationId);
    expect(organization.members).toHaveLength(2);
    expect(
      organization.invitations
        .filter((invite: { status: string }) => invite.status === "pending")
        .map((invite: { role: string }) => invite.role)
        .sort(),
    ).toEqual(visibleRoles);
  }
  for (const query of ["", `?organizationId=${organizationId}`]) {
    const response = await auth.handler(
      new Request(`http://localhost:3000/api/auth/organization/list-invitations${query}`, {
        headers,
      }),
    );
    expect(response.status).toBe(200);
    const invitations = await response.json();
    expect(
      invitations
        .filter((invite: { status: string }) => invite.status === "pending")
        .map((invite: { role: string }) => invite.role)
        .sort(),
    ).toEqual(visibleRoles);
  }
});

it.each([false, true])(
  "replaces invitations and enforces signup and verification with email enabled: %s",
  async (emailEnabled) => {
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
    /* oxlint-disable vitest/no-conditional-expect -- The test table covers each auth mode or endpoint, with shared success and lock assertions afterward. */
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
    /* oxlint-enable vitest/no-conditional-expect */
    await expect(accept(replacement.id)).resolves.toBeTruthy();
  },
);

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
])("holds and releases identity locks when $name", async ({ path, email, allowed }) => {
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
  /* oxlint-disable vitest/no-conditional-expect -- The test table covers each auth mode or endpoint, with shared success and lock assertions afterward. */
  if (path === "delete-user") {
    await expect(
      auth.api.createOrganization({
        body: { name: "Another", slug: "another", userId: "recipient" },
      }),
    ).rejects.toThrow("one workspace");
    expect(state.releaseLock).toHaveBeenCalledOnce();
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
    expect((await client.query("SELECT id FROM organization")).rows).toHaveLength(1);
  }
  /* oxlint-enable vitest/no-conditional-expect */
  state.lockQuery.mockClear();
  state.releaseLock.mockClear();
  let membersAtUnlock: number | undefined;
  state.lockQuery.mockImplementation(async (sql: string) => {
    expect(state.releaseLock).not.toHaveBeenCalled();
    if (sql.includes("pg_advisory_unlock")) {
      membersAtUnlock = (await client.query("SELECT id FROM member")).rows.length;
    }
    return { rows: [{ locked: true }] };
  });
  const response = await auth.handler(
    new Request(`http://localhost:3000/api/auth/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(
        email ? { organizationId, memberIdOrEmail: email } : { password: input.password },
      ),
    }),
  );
  expect(response.ok).toBe(allowed);
  expect(membersAtUnlock).toBe(allowed ? 1 : 2);
  expect(state.lockQuery).toHaveBeenCalledTimes(2);
  expect(state.releaseLock).toHaveBeenCalledOnce();
  /* oxlint-disable vitest/no-conditional-expect -- The test table covers each auth mode or endpoint, with shared success and lock assertions afterward. */
  if (path === "delete-user") {
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("Transfer ownership before deleting your account."),
    });
    expect((await client.query('SELECT id FROM "user"')).rows).toHaveLength(2);
  }
  /* oxlint-enable vitest/no-conditional-expect */
});

it.each([false, true])(
  "owns account deletion checks and locks with contention: %s",
  async (busy) => {
    const auth = createAuth();
    await setupWorkspace(input, database);
    const owner = await auth.api.signInEmail({ body: input, asResponse: true });
    const headers = new Headers({
      cookie: owner.headers.get("set-cookie") ?? "",
    });
    if (busy) state.lockQuery.mockResolvedValueOnce({ rows: [{ locked: false }] });
    await expect(auth.deleteAccount({ headers })).rejects.toMatchObject({
      status: busy ? "CONFLICT" : "FORBIDDEN",
      message: expect.stringContaining(busy ? "Please try again" : "only owner"),
    });
    expect(state.lockQuery).toHaveBeenCalledTimes(busy ? 1 : 2);
    expect(state.releaseLock).toHaveBeenCalledOnce();
    expect((await client.query('SELECT id FROM "user"')).rows).toHaveLength(1);
  },
);
