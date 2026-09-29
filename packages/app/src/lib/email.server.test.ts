// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(
    async (_message: {
      to: string;
      subject: string;
      text: string;
      html?: string;
    }) => {},
  ),
  logError: vi.fn(),
}));

vi.mock("@/lib/mailer.server", () => ({ mailer: { send: mocks.send } }));
vi.mock("@/env", () => ({
  env: { BETTER_AUTH_URL: "https://app.everr.dev" },
}));
vi.mock("@/telemetry/logger", () => ({
  serverLogger: { error: mocks.logError },
  exceptionAttributes: (error: unknown) => ({ error }),
}));

import {
  sendInvitationEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./email.server";

beforeEach(() => {
  vi.clearAllMocks();
});

it.each([
  {
    name: "verification",
    send: () =>
      sendVerificationEmail({
        to: "recipient@example.com",
        url: "https://example.com/verify-email/token",
      }),
    subject: "Verify your email address",
    heading: "Verify your email.",
    url: "https://example.com/verify-email/token",
  },
  {
    name: "password reset",
    send: () =>
      sendPasswordResetEmail({
        to: "recipient@example.com",
        url: "https://example.com/reset-password/token",
      }),
    subject: "Reset your password",
    heading: "Reset your password.",
    url: "https://example.com/reset-password/token",
  },
  {
    name: "invitation",
    send: () =>
      sendInvitationEmail({
        to: "recipient@example.com",
        inviterName: "Alex",
        organizationName: "Example Team",
        role: "member",
        inviteUrl: "https://example.com/invite/token",
      }),
    subject: "You've been invited to join Example Team",
    heading: "Join Example Team.",
    url: "https://example.com/invite/token",
  },
])("sends the $name template as HTML with a text fallback", async (email) => {
  email.send();

  await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
  const message = mocks.send.mock.calls[0]?.[0];
  expect(message).toMatchObject({
    to: "recipient@example.com",
    subject: email.subject,
  });
  expect(message?.text).toContain(email.url);
  expect(message?.html).toContain(email.heading);
  expect(message?.html).toContain(email.url);
  expect(message?.html).toContain("Everr");
  expect(message?.html).toContain(
    'src="https://app.everr.dev/email/everr-mark.png"',
  );
});

it("logs a delivery failure without rejecting the auth callback", async () => {
  mocks.send.mockRejectedValueOnce(new Error("SMTP unavailable"));

  expect(() =>
    sendVerificationEmail({
      to: "recipient@example.com",
      url: "https://example.com/verify-email/token",
    }),
  ).not.toThrow();

  await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledOnce());
  expect(mocks.logError).toHaveBeenCalledWith(
    "mailer.send.failed",
    expect.objectContaining({ error: expect.any(Error) }),
  );
});
