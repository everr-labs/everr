import { mailer } from "@/lib/mailer.server";

export function sendVerificationEmail({
  to,
  url,
}: {
  to: string;
  url: string;
}): void {
  mailer.send({
    to,
    subject: "Verify your email address",
    text: `Please verify your email address by clicking the link below:\n\n${url}`,
  });
}

export function sendPasswordResetEmail({
  to,
  url,
}: {
  to: string;
  url: string;
}): void {
  mailer.send({
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
  mailer.send({
    to,
    subject: `You've been invited to join ${organizationName}`,
    text: `${inviterName} has invited you to join ${organizationName} as ${role}.\n\nAccept your invitation:\n\n${inviteUrl}`,
  });
}
