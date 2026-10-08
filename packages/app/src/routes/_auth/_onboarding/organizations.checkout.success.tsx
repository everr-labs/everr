import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import * as z from "zod";
import { useOrganizationActivation } from "@/components/use-organization-activation";
import { completeProOrganizationCheckout } from "@/data/organizations";

const SearchSchema = z.object({ checkout_id: z.string().optional() });

export const Route = createFileRoute(
  "/_auth/_onboarding/organizations/checkout/success",
)({
  validateSearch: SearchSchema,
  head: () => ({ meta: [{ title: "Everr - Pro organization ready" }] }),
  component: ProOrganizationCheckoutSuccess,
});

function ProOrganizationCheckoutSuccess() {
  const selectOrganization = useOrganizationActivation();
  const { checkout_id: checkoutId } = Route.useSearch();
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const completion = useQuery({
    queryKey: ["pro-organization-checkout", checkoutId],
    enabled: Boolean(checkoutId),
    queryFn: () =>
      completeProOrganizationCheckout({
        data: { checkoutId: checkoutId ?? "" },
      }),
    refetchInterval: (query) =>
      query.state.data?.status === "completed" ? false : 1_000,
    retry: 3,
  });

  async function activateOrganization() {
    if (!organization) return;
    setActivating(true);
    setActivationError(null);
    try {
      await selectOrganization(
        organization.id,
        "/organization-setup?returnTo=%2F",
      );
    } catch (error) {
      setActivationError(
        error instanceof Error
          ? error.message
          : "The organization could not be selected. Please try again.",
      );
    } finally {
      setActivating(false);
    }
  }

  const organization =
    completion.data?.status === "completed"
      ? completion.data.organization
      : null;
  const completed = organization !== null;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10 lg:min-h-screen">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          {completed ? (
            <CheckCircle2 className="size-10 text-green-600" />
          ) : (
            <Loader2 className="size-10 animate-spin text-primary" />
          )}
          <CardTitle>
            {completed ? "Pro organization ready" : "Finalizing organization"}
          </CardTitle>
          <CardDescription>
            {completed
              ? `${organization.name} now has an active Pro subscription.`
              : "Everr is waiting for Polar to confirm the payment, then it will create the organization."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!checkoutId ? (
            <p role="alert" className="text-sm text-destructive">
              The checkout identifier is missing.
            </p>
          ) : null}
          {completion.error ? (
            <p role="alert" className="text-sm text-destructive">
              {completion.error instanceof Error
                ? completion.error.message
                : "The organization could not be finalized."}
            </p>
          ) : null}
          {activationError ? (
            <p role="alert" className="text-sm text-destructive">
              {activationError}
            </p>
          ) : null}
          <Button
            className="w-full"
            disabled={!completed || activating}
            onClick={() => void activateOrganization()}
          >
            {activating ? <Loader2 className="animate-spin" /> : null}
            Open organization
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
