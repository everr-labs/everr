// @vitest-environment node
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { setupWorkspace } from "@/app/installation.server";
import { createAuthTestDatabase } from "@/app/tests/auth-test-utils";

const state = vi.hoisted(() => ({
  database: undefined as unknown,
  emailEnabled: false,
  verificationUrl: "",
}));
vi.mock("@/db/client", () => ({
  get db() {
    return state.database;
  },
  pool: { options: {} },
}));
vi.mock("@/env/index", () => ({
  env: {
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "invitation-integration-test-secret-long-enough",
    NODE_ENV: "test",
  },
}));
vi.mock("@/lib/mailer.server", () => ({
  get mailer() {
    return state.emailEnabled ? { send: vi.fn() } : null;
  },
}));
vi.mock("@/lib/email.server", () => ({
  sendInvitationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendVerificationEmail: ({ url }: { url: string }) => {
    state.verificationUrl = url;
  },
}));
vi.unmock("@/lib/auth.server");

const { client, database } = await createAuthTestDatabase();
state.database = database;
afterAll(() => client.close());
beforeEach(async () => {
  vi.resetModules();
  state.verificationUrl = "";
  await client.exec(
    'TRUNCATE "user", account, organization, member, invitation, session, verification CASCADE',
  );
});
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
  state.emailEnabled = emailEnabled;
  const { auth } = await import("@/lib/auth.server");
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
