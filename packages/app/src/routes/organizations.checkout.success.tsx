import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import * as z from "zod";
import { completeProOrganizationCheckout } from "@/data/organizations";
import { authClient } from "@/lib/auth-client";

const SearchSchema = z.object({ checkout_id: z.string().optional() });

export const Route = createFileRoute("/organizations/checkout/success")({
  beforeLoad: ({ context: { session }, location }) => {
    if (!session?.user) {
      throw redirect({
        to: "/auth/sign-in",
        search: { redirect: location.href },
      });
    }
  },
  validateSearch: SearchSchema,
  head: () => ({ meta: [{ title: "Everr - Pro organization ready" }] }),
  component: ProOrganizationCheckoutSuccess,
});

function ProOrganizationCheckoutSuccess() {
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
    const activation = await authClient.organization.setActive({
      organizationId: organization.id,
    });
    if (activation.error) {
      setActivationError(
        "The organization is ready but could not be selected. Choose it from the organization menu.",
      );
      setActivating(false);
      return;
    }
    window.location.assign("/");
  }

  const organization =
    completion.data?.status === "completed"
      ? completion.data.organization
      : null;
  const completed = organization !== null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
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
