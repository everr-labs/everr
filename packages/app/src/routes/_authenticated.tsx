import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  ErrorComponent,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth.client";
import { auth } from "@/lib/auth.server";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";

/**
 * Verify the user's active organization is still valid (they're still a member).
 * Throws if the org is invalid so the error boundary can handle it.
 */
const verifyActiveOrg = createPartiallyAuthenticatedServerFn.handler(
  async ({ context: { session } }) => {
    const activeOrgId = session.session.activeOrganizationId;
    if (!activeOrgId) {
      throw new Error("No active organization");
    }

    // This throws if the user is no longer a member
    await auth.api.getFullOrganization({
      headers: getRequestHeaders(),
      query: { organizationId: activeOrgId },
    });

    return { activeOrganizationId: activeOrgId };
  },
);

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context: { session }, location }) => {
    if (!session?.user) {
      throw redirect({
        to: "/auth/sign-in",
        search: {
          redirect: `${location.pathname}${location.search}${location.hash}`,
        },
      });
    }

    const { activeOrganizationId } = await verifyActiveOrg();

    return {
      session: {
        ...session,
        session: {
          ...session.session,
          activeOrganizationId,
        },
      },
    };
  },
  errorComponent: AuthenticatedError,
});

function AuthenticatedError({ error }: { error: Error }) {
  const isOrgError =
    error.message.includes("not a member") ||
    error.message.includes("No active organization") ||
    error.message.includes("organization");

  if (!isOrgError) {
    return <ErrorComponent error={error} />;
  }

  return <OrgSwitcher />;
}

function OrgSwitcher() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: orgs, isPending, refetch } = authClient.useListOrganizations();

  useEffect(() => {
    refetch();
  }, []);

  const [switching, setSwitching] = useState<string | null>(null);

  async function handleSwitch(orgId: string) {
    setSwitching(orgId);
    await authClient.organization.setActive({ organizationId: orgId });
    await queryClient.invalidateQueries();
    router.invalidate();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl font-heading">
            Organization unavailable
          </CardTitle>
          <CardDescription>
            You no longer have access to this organization. Switch to another
            one to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : orgs && orgs.length > 0 ? (
            <div className="space-y-2">
              {orgs.map((org) => (
                <Button
                  key={org.id}
                  variant="outline"
                  className="w-full justify-start"
                  disabled={switching !== null}
                  onClick={() => void handleSwitch(org.id)}
                >
                  {switching === org.id && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  {org.name}
                </Button>
              ))}
            </div>
          ) : (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                You don't belong to any organizations.
              </p>
              <Button
                className="w-full"
                onClick={() => void router.navigate({ to: "/onboarding" })}
              >
                Create an organization
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
