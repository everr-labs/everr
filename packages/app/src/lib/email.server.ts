import { mailer } from "@/lib/mailer.server";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

// Auth emails are fire-and-forget: failures are logged, never surfaced to the
// request that triggered them.
function sendInBackground(params: Parameters<typeof mailer.send>[0]): void {
  void mailer
    .send(params)
    .catch((error) => serverLogger.error("mailer.send.failed", exceptionAttributes(error)));
}

export function sendVerificationEmail({ to, url }: { to: string; url: string }): void {
  sendInBackground({
    to,
    subject: "Verify your email address",
    text: `Please verify your email address by clicking the link below:\n\n${url}`,
  });
}

export function sendPasswordResetEmail({ to, url }: { to: string; url: string }): void {
  sendInBackground({
    to,
    subject: "Reset your password",
    text: `You requested a password reset. Click the link below to reset your password:\n\n${url}`,
  });
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
  sendInBackground({
    to,
    subject: `You've been invited to join ${organizationName}`,
    text: `${inviterName} has invited you to join ${organizationName} as ${role}.\n\nAccept your invitation:\n\n${inviteUrl}`,
  });
}
