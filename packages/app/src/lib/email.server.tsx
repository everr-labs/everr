import type { ReactElement } from "react";
import { render } from "react-email";
import InvitationEmail from "@/emails/invitation";
import PasswordResetEmail from "@/emails/password-reset";
import VerificationEmail from "@/emails/verification";
import { env } from "@/env";
import { mailer } from "@/lib/mailer.server";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

const assetBaseUrl = new URL("/email", env.BETTER_AUTH_URL).toString();

// Auth emails are fire-and-forget: failures are logged, never surfaced to the
// request that triggered them.
function sendInBackground(
  params: Parameters<typeof mailer.send>[0],
  email: ReactElement,
): void {
  void render(email)
    .then((html) => mailer.send({ ...params, html }))
    .catch((error) =>
      serverLogger.error("mailer.send.failed", exceptionAttributes(error)),
    );
}

export function sendVerificationEmail({
  to,
  url,
}: {
  to: string;
  url: string;
}): void {
  sendInBackground(
    {
      to,
      subject: "Verify your email address",
      text: `Please verify your email address by clicking the link below:\n\n${url}`,
    },
    <VerificationEmail assetBaseUrl={assetBaseUrl} url={url} />,
  );
}

export function sendPasswordResetEmail({
  to,
  url,
}: {
  to: string;
  url: string;
}): void {
  sendInBackground(
    {
      to,
      subject: "Reset your password",
      text: `You requested a password reset. Click the link below to reset your password:\n\n${url}`,
    },
    <PasswordResetEmail assetBaseUrl={assetBaseUrl} url={url} />,
  );
}

export function sendInvitationEmail({
  to,
  inviterName,
  organizationName,
  role,
  inviteUrl,
}: {
  to: string;
  inviterName: string;
  organizationName: string;
  role: string;
  inviteUrl: string;
}): void {
  sendInBackground(
    {
      to,
      subject: `You've been invited to join ${organizationName}`,
      text: `${inviterName} has invited you to join ${organizationName} as ${role}.\n\nAccept your invitation:\n\n${inviteUrl}`,
    },
    <InvitationEmail
      assetBaseUrl={assetBaseUrl}
      inviterName={inviterName}
      organizationName={organizationName}
      role={role}
      inviteUrl={inviteUrl}
    />,
  );
}
