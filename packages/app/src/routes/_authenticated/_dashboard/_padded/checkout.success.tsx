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
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
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
      query.state.status === "error" ||
      (query.state.data && query.state.data.status !== "pending")
        ? false
        : 1_000,
    retry: 3,
  });
  const completed = confirmation.data?.status === "completed";
  const billingConflict = confirmation.data?.status === "billing_conflict";
  const unavailable = !checkout_id || confirmation.isError;
  const title = completed
    ? "Pro is active"
    : billingConflict
      ? "Billing association needs attention"
      : unavailable
        ? "Payment confirmation unavailable"
        : "Confirming payment";
  const description = completed
    ? "The active Pro subscription has been confirmed."
    : billingConflict
      ? "Polar confirmed the payment, but its billing customer does not match this organization. Contact support with the checkout ID below to reconcile the payment. Do not repeat the purchase."
      : unavailable
        ? "The subscription could not be confirmed. Return to billing or reload this page to try again."
        : "Everr is verifying the subscription with Polar.";

  return (
    <div className="flex justify-center py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          {completed ? (
            <CheckCircle2 className="text-green-600 size-10" />
          ) : billingConflict || unavailable ? (
            <CircleAlert className="text-destructive size-10" />
          ) : (
            <Loader2 className="text-primary size-10 animate-spin" />
          )}
          <CardTitle>{title}</CardTitle>
          <CardDescription
            role={billingConflict || unavailable ? "alert" : undefined}
          >
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {checkout_id ? (
            <p className="text-muted-foreground text-xs text-center font-mono break-all">
              Checkout ID: {checkout_id}
            </p>
          ) : null}
          <Button
            className="w-full"
            disabled={!completed && !billingConflict && !unavailable}
            nativeButton={false}
            render={<Link to={completed ? "/" : "/billing"} />}
          >
            {completed ? "Back to dashboard" : "Back to billing"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
