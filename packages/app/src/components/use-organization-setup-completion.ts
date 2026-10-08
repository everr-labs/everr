import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

export const ORGANIZATION_SETUP_MINIMUM_MS = 2500;

export function useOrganizationSetupCompletion(
  ready: boolean,
  startedAt: number,
  returnTo: string,
) {
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void (async () => {
          await queryClient.invalidateQueries({
            queryKey: ["organization-creation-options"],
          });
          if (cancelled) return;
          await router.navigate({ href: returnTo, replace: true });
        })();
      },
      Math.max(0, startedAt + ORGANIZATION_SETUP_MINIMUM_MS - Date.now()),
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, startedAt, returnTo, router, queryClient]);
}
