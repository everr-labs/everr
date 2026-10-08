import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { completeOrganizationSetup } from "@/data/organization-provisioning";

export const ORGANIZATION_SETUP_MINIMUM_MS = 2500;

export function useOrganizationSetupCompletion(
  ready: boolean,
  startedAt: number,
  returnTo: string,
  organizationId: string,
  minimumDurationMs = ORGANIZATION_SETUP_MINIMUM_MS,
) {
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void Promise.resolve(
          completeOrganizationSetup({ data: { organizationId } }),
        )
          .then(() => {
            if (!cancelled)
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
  }, [ready, startedAt, returnTo, organizationId, router, minimumDurationMs]);
}
