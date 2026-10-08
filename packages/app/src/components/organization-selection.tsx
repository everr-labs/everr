import { Button, buttonVariants } from "@everr/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { OrganizationCreation } from "@/components/organization-creation";
import { useOrganizationActivation } from "@/components/use-organization-activation";
import { getOrganizationCreationOptions } from "@/data/organizations";
import { authClient } from "@/lib/auth-client";

export function OrganizationSelection() {
  const activateOrganization = useOrganizationActivation();
  const { returnTo } = useSearch({
    from: "/_auth/_onboarding/choose-organization",
  });

  const organizations = authClient.useListOrganizations();
  const organizationCreationOptions = useQuery({
    queryKey: ["organization-creation-options"],
    queryFn: () => getOrganizationCreationOptions(),
  });
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
  const [creating, setCreating] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const isLoading =
    !hasRefreshed || organizations.isPending || organizations.isRefetching;
  const hasOrganizations = Boolean(orgs?.length);

  async function handleSwitch(orgId: string) {
    setSwitching(orgId);
    setSwitchError(null);
    try {
      await activateOrganization(orgId, returnTo);
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

  if (
    organizationCreationOptions.data &&
    (creating || (!isLoading && !organizations.error && !hasOrganizations))
  ) {
    return (
      <OrganizationCreation
        canCreateHobby={organizationCreationOptions.data.canCreateHobby}
        notice={switchError}
        returnTo={returnTo}
        onStart={() => setCreating(true)}
      />
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10 lg:min-h-screen lg:py-16">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground">
            Your organizations
          </p>
          <h1 className="font-heading text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {isLoading || organizations.error
              ? "Finding your space"
              : hasOrganizations
                ? "Choose your organization"
                : "Let's get you settled"}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {isLoading
              ? "Checking your organization memberships."
              : organizations.error
                ? "Your organization memberships could not be loaded."
                : hasOrganizations
                  ? "Select an organization to continue, or create a new one for your team."
                  : "You're not part of an organization right now. Create one, or accept an invitation from your team."}
          </p>
        </div>

        <div className="space-y-3">
          {isLoading ? (
            <div
              className="flex items-center gap-2 py-2 text-sm text-muted-foreground"
              role="status"
            >
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Checking your organizations
            </div>
          ) : organizations.error ? (
            <div className="space-y-3">
              <p role="alert" className="text-sm text-destructive">
                Could not load your organizations. Please try again.
              </p>
              <Button
                variant="outline"
                onClick={() => void organizations.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : orgs && orgs.length > 0 ? (
            <div className="space-y-2">
              {orgs.map((org) => (
                <Button
                  key={org.id}
                  variant="outline"
                  className="w-full justify-between"
                  disabled={switching !== null}
                  onClick={() => void handleSwitch(org.id)}
                >
                  {org.name}
                  {switching === org.id ? (
                    <Loader2
                      className="size-4 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <ArrowRight
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </Button>
              ))}
            </div>
          ) : null}
          {switchError ? (
            <p role="alert" className="text-sm text-destructive">
              {switchError}
            </p>
          ) : null}
          <Link
            to="/create-organization"
            search={{ returnTo }}
            className={buttonVariants({ className: "w-full" })}
          >
            <Plus aria-hidden="true" />
            Create organization
          </Link>
        </div>
      </div>
    </main>
  );
}
