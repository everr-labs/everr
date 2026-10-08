import { Button } from "@everr/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";
import { returnToSchema } from "@/common/return-to";
import { OrganizationProvisioningContent } from "@/components/organization-provisioning-content";
import { useOrganizationActivation } from "@/components/use-organization-activation";
import { completeProOrganizationCheckout } from "@/data/organizations";

const SearchSchema = z.object({
  checkout_id: z.string().optional(),
  returnTo: returnToSchema.default("/"),
});

export const Route = createFileRoute(
  "/_welcome/_signedIn/organizations/checkout/success",
)({
  validateSearch: SearchSchema,
  head: () => ({ meta: [{ title: "Everr - Organization setup" }] }),
  component: ProOrganizationCheckoutSuccess,
});

function ProOrganizationCheckoutSuccess() {
  const selectOrganization = useOrganizationActivation();
  const { checkout_id: checkoutId, returnTo } = Route.useSearch();
  const activation = useMutation({
    mutationFn: (organizationId: string) =>
      selectOrganization(
        organizationId,
        `/organization-setup?returnTo=${encodeURIComponent(returnTo)}`,
      ),
  });
  const completion = useQuery({
    queryKey: ["pro-organization-checkout", checkoutId],
    enabled: Boolean(checkoutId),
    queryFn: async () => {
      const result = await completeProOrganizationCheckout({
        data: { checkoutId: checkoutId ?? "" },
      });
      if (result.status === "completed")
        await activation.mutateAsync(result.organization.id);
      return result;
    },
    refetchInterval: (query) =>
      query.state.status === "error" || query.state.data?.status === "completed"
        ? false
        : 1_000,
    retry: 3,
  });
  const error = activation.error ?? completion.error;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10 lg:min-h-screen lg:py-16">
      <div className="w-full max-w-sm space-y-8">
        <OrganizationProvisioningContent
          pending={Boolean(checkoutId) && !error}
        >
          {!checkoutId ? (
            <p role="alert" className="text-sm text-destructive">
              The checkout identifier is missing.
            </p>
          ) : null}
          {error ? (
            <div className="space-y-3">
              <p role="alert" className="text-sm text-destructive">
                {error instanceof Error
                  ? error.message
                  : "The organization could not be set up. Please try again."}
              </p>
              <Button
                className="w-full"
                disabled={completion.isFetching || activation.isPending}
                onClick={() => void completion.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : null}
        </OrganizationProvisioningContent>
      </div>
    </main>
  );
}
