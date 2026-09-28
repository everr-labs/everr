import { EmailLayout } from "../lib/email-layout";

interface PasswordResetEmailProps {
  assetBaseUrl?: string;
  url: string;
}

export default function PasswordResetEmail({
  assetBaseUrl,
  url,
}: PasswordResetEmailProps) {
  return (
    <EmailLayout
      assetBaseUrl={assetBaseUrl}
      preview="Reset your Everr password"
      title="Reset your password."
      description="You requested a password reset for your Everr account. Use the link below to choose a new password."
      actionLabel="Reset password"
      actionUrl={url}
      note="If you did not request this, you can ignore this email."
    />
  );
}

PasswordResetEmail.PreviewProps = {
  url: "https://example.com/reset-password",
} satisfies PasswordResetEmailProps;
