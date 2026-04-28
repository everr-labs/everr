import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Calendar,
  Check,
  CreditCard,
  Loader2,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  getOrgEntitlement,
  getOrgPortalUrl,
  startOrgCheckout,
} from "@/data/billing";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated/_dashboard/billing")({
  staticData: { breadcrumb: "Billing", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Billing" }],
  }),
  component: BillingPage,
});

const FREE_FEATURES = [
  "7-day data retention",
  "Up to 3 team members",
  "Community support",
  "Core dashboards",
];

const PRO_FEATURES = [
  "30-day data retention",
  "Unlimited team members",
  "Priority support",
  "Advanced dashboards & alerts",
  "AI-native trace inspection",
];

function BillingPage() {
  const { data: session } = authClient.useSession();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const userRole = activeOrg?.members?.find(
    (m) => m.userId === session?.user?.id,
  )?.role;
  const isAdmin = userRole === "admin" || userRole === "owner";

  const { data: entitlement, isLoading } = useQuery({
    queryKey: ["billing", "entitlement", activeOrg?.id],
    enabled: Boolean(activeOrg?.id) && isAdmin,
    queryFn: () => getOrgEntitlement(),
  });

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-3">
        <Header orgName={activeOrg?.name} />
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground text-sm">
              Only organization admins can manage billing.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isPro = entitlement?.tier === "pro";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <Header orgName={activeOrg?.name} />

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : isPro ? (
        <ProHero entitlement={entitlement} />
      ) : (
        <FreeHero />
      )}

      {!isLoading ? isPro ? <ManageBillingCard /> : <PlanComparison /> : null}
    </div>
  );
}

function Header({ orgName }: { orgName?: string }) {
  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Billing</h1>
      <p className="text-muted-foreground text-sm">
        Manage the plan and billing for{" "}
        <span className="font-medium">{orgName ?? "your organization"}</span>.
      </p>
    </div>
  );
}

function ProHero({
  entitlement,
}: {
  entitlement: {
    status: string | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  };
}) {
  const renewalDate = entitlement.currentPeriodEnd
    ? new Date(entitlement.currentPeriodEnd).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card">
      <div className="absolute -right-16 -top-16 size-48 rounded-full bg-primary/10 blur-3xl" />
      <CardHeader className="relative">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="size-5" />
          </div>
          <div className="flex-1">
            <p className="text-muted-foreground text-xs uppercase tracking-wider">
              Current plan
            </p>
            <CardTitle className="text-2xl">Pro</CardTitle>
          </div>
          <Badge variant="default" className="capitalize">
            {entitlement.status ?? "active"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="relative space-y-4">
        {renewalDate ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Calendar className="size-4" />
            <span>
              {entitlement.cancelAtPeriodEnd ? "Ends" : "Renews"} on{" "}
              <span className="text-foreground font-medium">{renewalDate}</span>
            </span>
          </div>
        ) : null}
        <ul className="grid gap-2 sm:grid-cols-2">
          {PRO_FEATURES.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-sm">
              <Check className="size-4 text-primary" />
              {feature}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function FreeHero() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-lg">
            <CreditCard className="size-5" />
          </div>
          <div className="flex-1">
            <p className="text-muted-foreground text-xs uppercase tracking-wider">
              Current plan
            </p>
            <CardTitle className="text-2xl">Free</CardTitle>
          </div>
          <Badge variant="secondary">No subscription</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2">
          {FREE_FEATURES.map((feature) => (
            <li
              key={feature}
              className="text-muted-foreground flex items-center gap-2 text-sm"
            >
              <Check className="size-4" />
              {feature}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function PlanComparison() {
  return (
    <div>
      <h2 className="text-sm font-semibold tracking-tight mb-3">
        Upgrade your plan
      </h2>
      <Card className="relative overflow-hidden border-primary/40">
        <div className="absolute -right-20 -top-20 size-56 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute right-4 top-4">
          <Badge variant="default" className="gap-1">
            <Zap className="size-3" />
            Recommended
          </Badge>
        </div>
        <CardHeader className="relative pb-3">
          <div className="flex items-center gap-3">
            <div className="bg-primary/15 text-primary flex size-10 items-center justify-center rounded-lg">
              <Sparkles className="size-5" />
            </div>
            <div>
              <CardTitle className="text-xl">Pro</CardTitle>
              <CardDescription>
                Everything you need to ship reliable agents
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="relative space-y-4">
          <ul className="grid gap-2 sm:grid-cols-2">
            {PRO_FEATURES.map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-sm">
                <Check className="text-primary size-4" />
                {feature}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-muted-foreground text-xs">
              Cancel anytime from the billing portal.
            </p>
            <UpgradeButton />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UpgradeButton() {
  const upgrade = useMutation({
    mutationFn: () => startOrgCheckout({ data: { slug: "pro" } }),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
  return (
    <Button
      onClick={() => upgrade.mutate()}
      disabled={upgrade.isPending || upgrade.isSuccess}
    >
      {upgrade.isPending || upgrade.isSuccess ? (
        <Loader2 className="animate-spin" />
      ) : (
        <Sparkles />
      )}
      {upgrade.isPending || upgrade.isSuccess
        ? "Starting checkout…"
        : "Upgrade to Pro"}
      {!(upgrade.isPending || upgrade.isSuccess) ? <ArrowUpRight /> : null}
    </Button>
  );
}

function ManageBillingCard() {
  const portal = useMutation({
    mutationFn: () => getOrgPortalUrl(),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Billing & invoices</CardTitle>
        <CardDescription>
          Update payment method, download invoices, or cancel your subscription.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          onClick={() => portal.mutate()}
          disabled={portal.isPending || portal.isSuccess}
        >
          {portal.isPending || portal.isSuccess ? (
            <Loader2 className="animate-spin" />
          ) : (
            <CreditCard />
          )}
          {portal.isPending || portal.isSuccess
            ? "Opening portal…"
            : "Open billing portal"}
          {!(portal.isPending || portal.isSuccess) ? <ArrowUpRight /> : null}
        </Button>
      </CardContent>
    </Card>
  );
}
