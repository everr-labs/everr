import { Button, buttonVariants } from "@everr/ui/components/button";
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
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Loader2, Plus, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { CreateOrganizationDialog } from "@/components/create-organization-dialog";
import { auth } from "@/lib/auth.server";
import { authClient } from "@/lib/auth-client";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";

/**
 * Verify the user's active organization is still valid (they're still a member).
 * Throws if the org is invalid so the error boundary can handle it.
 */
const verifyActiveOrg = createPartiallyAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) => {
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
});

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({
    context: { session },
    location: { pathname, hash },
    search,
  }) => {
    if (!session?.user) {
      const redirectTo = `${pathname}?${Object.entries(search)
        .map(([key, value]) => `${key}=${value}`)
        .join("&")}${hash ? `#${hash}` : ""}`;

      // CLI device approval is reached by people setting up a fresh machine, who
      // most often don't have an account yet — send them to sign-up (the page
      // toggles to sign-in and back, preserving this redirect).
      const to = pathname === "/device" ? "/auth/sign-up" : "/auth/sign-in";
      throw redirect({ to, search: { redirect: redirectTo } });
    }

    if (pathname === "/account") {
      return {
        session: {
          ...session,
          session: {
            ...session.session,
            // Account settings do not consume organization context. Preserve
            // the narrowed parent type for organization-scoped descendants.
            activeOrganizationId: session.session.activeOrganizationId ?? "",
          },
        },
      };
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

  const organizations = authClient.useListOrganizations();
  const orgs = organizations.data;
  const { refetch } = organizations;
  const [hasRefreshed, setHasRefreshed] = useState(false);

  useEffect(() => {
    let mounted = true;
    // The menu may have cached memberships before access was revoked.
    void refetch().then(() => {
      if (mounted) setHasRefreshed(true);
    });
    return () => {
      mounted = false;
    };
  }, [refetch]);

  const [switching, setSwitching] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [isCreateOrgDialogOpen, setCreateOrgDialogOpen] = useState(false);
  const isLoading =
    !hasRefreshed || organizations.isPending || organizations.isRefetching;
  const hasOrganizations = Boolean(orgs?.length);

  async function handleSwitch(orgId: string) {
    setSwitching(orgId);
    setSwitchError(null);
    try {
      const { error } = await authClient.organization.setActive({
        organizationId: orgId,
      });
      if (error)
        throw new Error(error.message ?? "Could not select this organization.");
      await queryClient.invalidateQueries();
      await router.invalidate();
    } catch (error) {
      setSwitchError(
        error instanceof Error
          ? error.message
          : "Could not select this organization.",
      );
      await organizations.refetch();
    } finally {
      setSwitching(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl font-heading">
            {isLoading || organizations.error
              ? "Your organizations"
              : hasOrganizations
                ? "Choose an organization"
                : "You don't belong to an organization"}
          </CardTitle>
          <CardDescription>
            {isLoading
              ? "Checking your organization memberships."
              : organizations.error
                ? "Your organization memberships could not be loaded."
                : hasOrganizations
                  ? "Select an organization to continue, or create a new one for your team."
                  : "Create an organization to get started, or manage your account settings."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : organizations.error ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                Could not load your organizations. Please try again.
              </p>
              <Button
                variant="outline"
                onClick={() => void organizations.refetch()}
              >
                Retry
              </Button>
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
          ) : null}
          {switchError ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {switchError}
            </p>
          ) : null}
          <Button
            className="mt-4 w-full"
            disabled={switching !== null}
            onClick={() => setCreateOrgDialogOpen(true)}
          >
            <Plus />
            Create organization
          </Button>
          <Link
            to="/account"
            className={buttonVariants({
              variant: "outline",
              className: "mt-2 w-full",
            })}
          >
            <Settings />
            Account settings
          </Link>
        </CardContent>
      </Card>
      <CreateOrganizationDialog
        open={isCreateOrgDialogOpen}
        onOpenChange={setCreateOrgDialogOpen}
      />
    </main>
  );
}
