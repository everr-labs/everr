import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import * as z from "zod";

const SearchSchema = z.object({
  checkout_id: z.string().optional(),
});

export const Route = createFileRoute(
  "/_authenticated/_dashboard/checkout/success",
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

  return (
    <div className="flex justify-center py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <CheckCircle2 className="text-green-600 size-10" />
          <CardTitle>Payment successful</CardTitle>
          <CardDescription>
            Your subscription is being provisioned. This may take a few seconds.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {checkout_id ? (
            <p className="text-muted-foreground text-xs text-center font-mono break-all">
              Checkout ID: {checkout_id}
            </p>
          ) : null}
          <Button className="w-full" render={<Link to="/" />}>
            Back to dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
