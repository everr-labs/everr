import { EmailLayout } from "../lib/email-layout";

interface VerificationEmailProps {
  assetBaseUrl?: string;
  url: string;
}

export default function VerificationEmail({
  assetBaseUrl,
  url,
}: VerificationEmailProps) {
  return (
    <EmailLayout
      assetBaseUrl={assetBaseUrl}
      preview="Verify your email address"
      title="Verify your email."
      description="Please verify your email address to finish setting up your Everr account."
      actionLabel="Verify email address"
      actionUrl={url}
    />
  );
}

VerificationEmail.PreviewProps = {
  url: "https://example.com/verify-email",
} satisfies VerificationEmailProps;
