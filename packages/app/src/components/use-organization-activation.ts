import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { authClient } from "@/lib/auth-client";

export function useOrganizationActivation() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useCallback(
    async (organizationId: string, returnTo?: string) => {
      const { error } = await authClient.organization.setActive({
        organizationId,
      });
      if (error)
        throw new Error(error.message ?? "Could not select this organization.");

      // Stop previous organization requests from repopulating the shared cache.
      // Mark data stale, then let the guard redirect before starting refetches.
      await queryClient.cancelQueries();
      await queryClient.invalidateQueries({ refetchType: "none" });
      if (returnTo === undefined) await router.invalidate();
      else await router.navigate({ href: returnTo, replace: true });
      await queryClient.refetchQueries({ type: "active" });
    },
    [router, queryClient],
  );
}
