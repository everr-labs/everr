import { useQuery } from "@tanstack/react-query";
import { useRouteContext, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { isMissingOrganizationError } from "@/common/organization-onboarding";
import { OrganizationProvisioningContent } from "@/components/organization-provisioning-content";
import { useOrganizationSetupCompletion } from "@/components/use-organization-setup-completion";
import { getActiveOrganization } from "@/data/auth";

export function OrganizationSetup() {
  const router = useRouter();
  const { session } = useRouteContext({ from: "/_auth/_onboarding" });
  const { returnTo } = useSearch({
    from: "/_auth/_onboarding/organization-setup",
  });
  const [startedAt] = useState(() => Date.now());
  const status = useQuery({
    queryKey: [
      "organization-provisioning",
      session.session.activeOrganizationId,
    ],
    queryFn: () => getActiveOrganization(),
    refetchInterval: 3000,
    staleTime: 0,
  });

  useOrganizationSetupCompletion(
    status.isSuccess &&
      !status.isFetching &&
      status.data?.clickhouseReady === true,
    startedAt,
    returnTo,
  );

  useEffect(() => {
    if (
      (status.isSuccess && !status.data) ||
      (status.isError && isMissingOrganizationError(status.error))
    ) {
      void router.navigate({
        to: "/choose-organization",
        search: { returnTo },
        replace: true,
      });
    }
  }, [
    status.isSuccess,
    status.isError,
    status.error,
    status.data,
    router,
    returnTo,
  ]);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10 lg:min-h-screen lg:py-16">
      <div className="w-full max-w-sm space-y-8">
        <OrganizationProvisioningContent>
          {status.isError && (
            <p role="alert" className="text-sm text-destructive">
              We couldn't check your setup status. We'll try again
              automatically.
            </p>
          )}
        </OrganizationProvisioningContent>
      </div>
    </main>
  );
}
