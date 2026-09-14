import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Loader2 } from "lucide-react";
import * as z from "zod";
import { confirmOrgCheckout } from "@/data/billing";

const SearchSchema = z.object({
  checkout_id: z.string().optional(),
});

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_padded/checkout/success",
)({
  staticData: { breadcrumb: "Checkout", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Checkout complete" }],
  }),
  validateSearch: SearchSchema,
  component: CheckoutSuccessPage,
});

function CheckoutSuccessPage() {
  const { checkout_id } = Route.useSearch();
  const confirmation = useQuery({
    queryKey: ["organization-checkout", checkout_id],
    enabled: Boolean(checkout_id),
    queryFn: () =>
      confirmOrgCheckout({ data: { checkoutId: checkout_id ?? "" } }),
    refetchInterval: (query) =>
      query.state.data?.status === "completed" ? false : 1_000,
    retry: 3,
  });
  const completed = confirmation.data?.status === "completed";

  return (
    <div className="flex justify-center py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          {completed ? (
            <CheckCircle2 className="text-green-600 size-10" />
          ) : (
            <Loader2 className="text-primary size-10 animate-spin" />
          )}
          <CardTitle>
            {completed ? "Pro is active" : "Confirming payment"}
          </CardTitle>
          <CardDescription>
            {completed
              ? "The active Pro subscription has been confirmed."
              : "Everr is verifying the subscription with Polar."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {checkout_id ? (
            <p className="text-muted-foreground text-xs text-center font-mono break-all">
              Checkout ID: {checkout_id}
            </p>
          ) : null}
          {confirmation.error ? (
            <p role="alert" className="text-center text-sm text-destructive">
              The subscription could not be confirmed. Reload this page to try
              again.
            </p>
          ) : null}
          <Button
            className="w-full"
            disabled={!completed}
            nativeButton={false}
            render={<Link to="/" />}
          >
            Back to dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
