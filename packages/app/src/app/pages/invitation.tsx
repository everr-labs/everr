import { Button } from "@everr/ui/components/button";
import { type ReactNode, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function InvitationAccess({
  invitationId,
  children,
}: {
  invitationId: string;
  children: ReactNode;
}) {
  const { data: session, isPending } = authClient.useSession();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (isPending) return <p>Checking your account...</p>;
  if (session?.user.emailVerified) return children;
  return (
    <div className="space-y-4">
      <h1 className="font-heading text-3xl">Verify your email</h1>
      <p>
        Open the verification email sent to your address. You'll return here to
        accept your workspace invitation.
      </p>
      <Button
        disabled={pending || !session?.user}
        onClick={async () => {
          if (!session?.user) return;
          setPending(true);
          setMessage(null);
          try {
            const result = await authClient.sendVerificationEmail({
              email: session.user.email,
              callbackURL: `/invite/${invitationId}`,
            });
            setMessage(
              result.error
                ? (result.error.message ?? "Could not send verification email.")
                : "Verification email sent. Check your inbox.",
            );
          } catch {
            setMessage("Could not send verification email. Please try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Sending..." : "Resend verification email"}
      </Button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
