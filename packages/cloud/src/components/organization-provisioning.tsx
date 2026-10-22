import { productClient } from "@composition/client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getOrganizationProvisioningStatus } from "../organization-provisioning/actions";
import { ORGANIZATION_SETUP_DELAY_NOTICE_MS } from "../organization-provisioning/metadata";
import { OrganizationProvisioningContent } from "./organization-provisioning-content";
import { OrganizationProvisioningRetry } from "./organization-provisioning-retry";
import { useOrganizationSetupCompletion } from "./use-organization-setup-completion";

export function OrganizationProvisioning({
  organizationId,
  startedAt,
  returnTo,
  minimumDurationMs,
}: {
  organizationId: string;
  startedAt: number;
  returnTo: string;
  minimumDurationMs?: number;
}) {
  const router = useRouter();
  const [takingLonger, setTakingLonger] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTakingLonger(true), ORGANIZATION_SETUP_DELAY_NOTICE_MS);
    return () => clearTimeout(timer);
  }, []);
  const status = useQuery({
    queryKey: ["organization-provisioning", organizationId],
    queryFn: () => getOrganizationProvisioningStatus(),
    refetchInterval: (query) => (query.state.data?.status === "failed" ? false : 3000),
    staleTime: 0,
  });

  useOrganizationSetupCompletion(
    status.isSuccess &&
      !status.isFetching &&
      status.data?.id === organizationId &&
      status.data?.status === "ready",
    startedAt,
    returnTo,
    organizationId,
    minimumDurationMs,
  );

  useEffect(() => {
    if (status.isSuccess && (!status.data || status.data.id !== organizationId)) {
      void router.navigate({
        to: productClient.missingWorkspaceRoute,
        search: { returnTo },
        replace: true,
      });
    }
  }, [organizationId, status.isSuccess, status.data, router, returnTo]);

  return (
    <OrganizationProvisioningContent
      failed={status.data?.status === "failed"}
      takingLonger={takingLonger && status.data?.status !== "ready"}
    >
      {status.data?.status === "failed" && (
        <OrganizationProvisioningRetry key={status.data.id} organizationId={status.data.id} />
      )}
    </OrganizationProvisioningContent>
  );
}
