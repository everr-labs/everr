import { EmailLayout } from "../lib/email-layout";

interface InvitationEmailProps {
  assetBaseUrl?: string;
  inviterName: string;
  organizationName: string;
  role: string;
  inviteUrl: string;
}

export default function InvitationEmail({
  assetBaseUrl,
  inviterName,
  organizationName,
  role,
  inviteUrl,
}: InvitationEmailProps) {
  return (
    <EmailLayout
      assetBaseUrl={assetBaseUrl}
      preview={`You've been invited to join ${organizationName}`}
      title={`Join ${organizationName}.`}
      description={`${inviterName} has invited you to join ${organizationName} as ${role}.`}
      actionLabel="Accept invitation"
      actionUrl={inviteUrl}
    />
  );
}

InvitationEmail.PreviewProps = {
  inviterName: "Alex",
  organizationName: "Example Team",
  role: "member",
  inviteUrl: "https://example.com/invite",
} satisfies InvitationEmailProps;
