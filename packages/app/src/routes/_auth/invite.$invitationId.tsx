import { Button } from "@everr/ui/components/button";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import {
  type InvitationLookup,
  isMemberOfOrg,
  lookupInvitation,
} from "@/data/invite";
import { authClient } from "@/lib/auth-client";

type LoaderResult =
  | { status: "not-found" }
  | {
      status: "inactive";
      reason: "expired" | "canceled" | "rejected";
      organizationName: string;
    }
  | {
      status: "accepted";
      organizationName: string;
      alreadyMember: boolean;
    }
  | {
      status: "unauthenticated";
      organizationName: string;
      invitedEmail: string;
      inviterName: string;
      role: string | null;
    }
  | {
      status: "accept-ready";
      invitationId: string;
      organizationName: string;
      inviterName: string;
      role: string | null;
    }
  | {
      status: "wrong-recipient";
      organizationName: string;
      invitedEmail: string;
    };

async function resolveLoaderResult(
  invitationId: string,
  session: { user: { email: string } } | null,
  lookup: InvitationLookup,
): Promise<LoaderResult> {
  if (lookup.status === "not-found") return { status: "not-found" };
  if (lookup.status === "inactive") return lookup;

  if (lookup.status === "accepted") {
    const alreadyMember = session
      ? (
          await isMemberOfOrg({
            data: { organizationId: lookup.organizationId },
          })
        ).isMember
      : false;
    return {
      status: "accepted",
      organizationName: lookup.organizationName,
      alreadyMember,
    };
  }

  if (!session) {
    return {
      status: "unauthenticated",
      organizationName: lookup.organizationName,
      invitedEmail: lookup.invitedEmail,
      inviterName: lookup.inviterName,
      role: lookup.role,
    };
  }

  if (session.user.email.toLowerCase() !== lookup.invitedEmail.toLowerCase()) {
    return {
      status: "wrong-recipient",
      organizationName: lookup.organizationName,
      invitedEmail: lookup.invitedEmail,
    };
  }

  return {
    status: "accept-ready",
    invitationId,
    organizationName: lookup.organizationName,
    inviterName: lookup.inviterName,
    role: lookup.role,
  };
}

export const Route = createFileRoute("/_auth/invite/$invitationId")({
  loader: async ({ context: { session }, params: { invitationId } }) => {
    const lookup = await lookupInvitation({ data: { invitationId } });
    return resolveLoaderResult(invitationId, session, lookup);
  },
  component: AcceptInvitation,
});

function AcceptInvitation() {
  const { invitationId } = Route.useParams();
  const data = Route.useLoaderData();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        {data.status === "not-found" && <NotFoundContent />}
        {data.status === "inactive" && <InactiveContent data={data} />}
        {data.status === "accepted" && <AcceptedContent data={data} />}
        {data.status === "unauthenticated" && (
          <UnauthenticatedContent invitationId={invitationId} data={data} />
        )}
        {data.status === "accept-ready" && <AcceptReadyContent data={data} />}
        {data.status === "wrong-recipient" && (
          <WrongRecipientContent invitationId={invitationId} data={data} />
        )}
      </div>
    </main>
  );
}

function Heading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string | React.ReactNode;
}) {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-bold tracking-tight font-heading">
        {title}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function NotFoundContent() {
  return (
    <>
      <Heading
        title="Invitation unavailable"
        subtitle="This invitation link is invalid or has expired."
      />
      <Button
        variant="outline"
        className="w-full"
        nativeButton={false}
        render={<Link to="/">Go home</Link>}
      />
    </>
  );
}

function InactiveContent({
  data,
}: {
  data: Extract<LoaderResult, { status: "inactive" }>;
}) {
  const title =
    data.reason === "expired"
      ? "Invitation expired"
      : "Invitation no longer available";
  const subtitle =
    data.reason === "expired"
      ? `Your invitation to ${data.organizationName} has expired. Ask for a new one to join.`
      : `Your invitation to ${data.organizationName} is no longer available.`;

  return (
    <>
      <Heading title={title} subtitle={subtitle} />
      <Button
        variant="outline"
        className="w-full"
        nativeButton={false}
        render={<Link to="/">Go home</Link>}
      />
    </>
  );
}

function AcceptedContent({
  data,
}: {
  data: Extract<LoaderResult, { status: "accepted" }>;
}) {
  const title = data.alreadyMember
    ? `You're already in ${data.organizationName}`
    : "Invitation already used";
  const subtitle = data.alreadyMember
    ? "You've already joined this organization."
    : "This invitation has already been accepted.";

  return (
    <>
      <Heading title={title} subtitle={subtitle} />
      <Button
        className="w-full"
        nativeButton={false}
        render={<Link to="/">Go home</Link>}
      />
    </>
  );
}

function UnauthenticatedContent({
  invitationId,
  data,
}: {
  invitationId: string;
  data: Extract<LoaderResult, { status: "unauthenticated" }>;
}) {
  return (
    <>
      <Heading
        title={`Join ${data.organizationName}`}
        subtitle={
          <>
            {data.inviterName} is inviting you to join
            {data.role ? ` as ${data.role}` : ""}.
          </>
        }
      />
      <div className="flex gap-2">
        <Button
          className="flex-1"
          nativeButton={false}
          render={
            <Link
              to="/auth/sign-in"
              search={{
                redirect: `/invite/${invitationId}`,
                email: data.invitedEmail,
              }}
            />
          }
        >
          Sign in
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          nativeButton={false}
          render={
            <Link
              to="/auth/sign-up"
              search={{
                redirect: `/invite/${invitationId}`,
                email: data.invitedEmail,
              }}
            />
          }
        >
          Create account
        </Button>
      </div>
    </>
  );
}

function AcceptReadyContent({
  data,
}: {
  data: Extract<LoaderResult, { status: "accept-ready" }>;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);

  async function handleAccept() {
    setError(null);
    setPending("accept");

    try {
      const result = await authClient.organization.acceptInvitation({
        invitationId: data.invitationId,
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
      setPending(null);
    }
  }

  async function handleDecline() {
    setError(null);
    setPending("decline");

    try {
      const result = await authClient.organization.rejectInvitation({
        invitationId: data.invitationId,
      });

      if (result.error) {
        setError(
          result.error.message ??
            "Failed to decline invitation. Please try again.",
        );
        return;
      }

      await navigate({ to: "/" });
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <Heading
        title={`Join ${data.organizationName}`}
        subtitle={
          <>
            {data.inviterName} is inviting you to join
            {data.role ? ` as ${data.role}` : ""}.
          </>
        }
      />
      <div className="space-y-4">
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() => void handleAccept()}
            disabled={pending !== null}
          >
            {pending === "accept" ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Accepting...
              </>
            ) : (
              "Accept"
            )}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => void handleDecline()}
            disabled={pending !== null}
          >
            {pending === "decline" ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Declining...
              </>
            ) : (
              "Decline"
            )}
          </Button>
        </div>
      </div>
    </>
  );
}

function WrongRecipientContent({
  invitationId,
  data,
}: {
  invitationId: string;
  data: Extract<LoaderResult, { status: "wrong-recipient" }>;
}) {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSwitchAccount() {
    setIsSigningOut(true);
    try {
      await authClient.signOut();
      await navigate({
        to: "/auth/sign-in",
        search: {
          redirect: `/invite/${invitationId}`,
          email: data.invitedEmail,
        },
      });
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <>
      <Heading
        title="Wrong account"
        subtitle={
          <>
            This invitation to {data.organizationName} was sent to{" "}
            <span className="font-medium text-foreground">
              {data.invitedEmail}
            </span>
            . Sign in with that account to accept it.
          </>
        }
      />
      <Button
        className="w-full"
        onClick={() => void handleSwitchAccount()}
        disabled={isSigningOut}
      >
        {isSigningOut ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Signing out...
          </>
        ) : (
          "Sign in as another account"
        )}
      </Button>
    </>
  );
}
