import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { isMissingOrganizationError } from "@/common/organization-onboarding";
import { OrganizationProvisioningContent } from "@/components/organization-provisioning-content";
import { OrganizationProvisioningRetry } from "@/components/organization-provisioning-retry";
import { useOrganizationSetupCompletion } from "@/components/use-organization-setup-completion";
import { getOrganizationProvisioningStatus } from "@/data/organization-provisioning";

export function OrganizationProvisioning({
  organizationId,
  startedAt,
  returnTo,
}: {
  organizationId: string;
  startedAt: number;
  returnTo: string;
}) {
  const router = useRouter();
  const status = useQuery({
    queryKey: ["organization-provisioning", organizationId],
    queryFn: () => getOrganizationProvisioningStatus(),
    refetchInterval: (query) =>
      query.state.data?.status === "failed" ? false : 3000,
    staleTime: 0,
  });

  useOrganizationSetupCompletion(
    status.isSuccess &&
      !status.isFetching &&
      status.data?.id === organizationId &&
      status.data?.status === "ready",
    startedAt,
    returnTo,
  );

  useEffect(() => {
    if (
      (status.isSuccess &&
        (!status.data || status.data.id !== organizationId)) ||
      (status.isError && isMissingOrganizationError(status.error))
    ) {
      void router.navigate({
        to: "/choose-organization",
        search: { returnTo },
        replace: true,
      });
    }
  }, [
    organizationId,
    status.isSuccess,
    status.isError,
    status.error,
    status.data,
    router,
    returnTo,
  ]);

  return (
    <OrganizationProvisioningContent failed={status.data?.status === "failed"}>
      {status.data?.status === "failed" && (
        <OrganizationProvisioningRetry
          key={status.data.id}
          organizationId={status.data.id}
        />
      )}
    </OrganizationProvisioningContent>
  );
}
