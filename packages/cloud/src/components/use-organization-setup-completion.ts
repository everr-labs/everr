import { resetRouteAccess } from "@everr/app/lib/route-access-cache";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { completeOrganizationSetup } from "../organization-provisioning/actions";

export const ORGANIZATION_SETUP_MINIMUM_MS = 2500;

export function useOrganizationSetupCompletion(
  ready: boolean,
  startedAt: number,
  returnTo: string,
  organizationId: string,
  minimumDurationMs = ORGANIZATION_SETUP_MINIMUM_MS,
) {
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void Promise.resolve(completeOrganizationSetup({ data: { organizationId } }))
          .then(() => {
            if (cancelled) return;
            // The organization is now provisioned and past its setup entry.
            resetRouteAccess(queryClient);
            return router.navigate({ href: returnTo, replace: true });
          })
          .catch(() => {
            /* The next readiness poll retries the continuation. */
          });
      },
      Math.max(0, startedAt + minimumDurationMs - Date.now()),
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, startedAt, returnTo, organizationId, router, queryClient, minimumDurationMs]);
}
