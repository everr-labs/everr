import { authClient } from "@everr/app/identity/client";
import { applyAccessChange } from "@everr/app/lib/route-access-cache";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

export function useOrganizationActivation() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useCallback(
    async (organizationId: string, returnTo?: string) => {
      const { error } = await authClient.organization.setActive({
        organizationId,
      });
      if (error) throw new Error(error.message ?? "Could not select this organization.");

      await applyAccessChange(queryClient, router, returnTo);
    },
    [router, queryClient],
  );
}
