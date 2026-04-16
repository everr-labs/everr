import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/auth/accept-invitation/$invitationId")({
  component: AcceptInvitation,
});

function AcceptInvitation() {
  const { invitationId } = Route.useParams();
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  async function handleAccept() {
    setError(null);
    setIsAccepting(true);

    try {
      const result = await authClient.organization.acceptInvitation({
        invitationId,
      });

      if (result.error) {
        setError(
          result.error.message ??
            "Failed to accept invitation. Please try again.",
        );
        return;
      }

      await navigate({ to: "/" });
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsAccepting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>You've been invited</CardTitle>
            <CardDescription>
              You have a pending organization invitation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {session?.user ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Signed in as{" "}
                  <span className="font-medium text-foreground">
                    {session.user.email}
                  </span>
                </p>

                {error && (
                  <p className="text-xs text-destructive" role="alert">
                    {error}
                  </p>
                )}

                <Button
                  className="w-full"
                  onClick={() => void handleAccept()}
                  disabled={isAccepting}
                >
                  {isAccepting ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Accepting...
                    </>
                  ) : (
                    "Accept invitation"
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Sign in or create an account to accept this invitation.
                </p>

                <div className="flex flex-col gap-2">
                  <Button
                    className="w-full"
                    render={
                      <Link
                        to="/auth/sign-in"
                        search={{
                          redirect: `/auth/accept-invitation/${invitationId}`,
                        }}
                      />
                    }
                  >
                    Sign in
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    render={
                      <Link
                        to="/auth/sign-up"
                        search={{
                          redirect: `/auth/accept-invitation/${invitationId}`,
                        }}
                      />
                    }
                  >
                    Create account
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
