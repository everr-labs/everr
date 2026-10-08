import { Button } from "@everr/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { retryOrganizationProvisioning } from "@/data/organization-provisioning";

export function OrganizationProvisioningRetry({
  organizationId,
}: {
  organizationId: string;
}) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () =>
      retryOrganizationProvisioning({ data: { organizationId } }),
    onSuccess: async () => {
      const queryKey = ["organization-provisioning", organizationId];
      // A successful restart must resume polling even if its first read fails.
      queryClient.setQueryData(queryKey, {
        id: organizationId,
        status: "pending",
      });
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  return (
    <div className="space-y-3">
      {retry.error && (
        <p role="alert" className="text-sm text-destructive">
          {retry.error instanceof Error
            ? retry.error.message
            : "Setup could not be restarted."}
        </p>
      )}
      <Button
        className="w-full"
        disabled={retry.isPending}
        onClick={() => retry.mutate()}
      >
        {retry.isPending ? "Restarting setup..." : "Try again"}
      </Button>
    </div>
  );
}
