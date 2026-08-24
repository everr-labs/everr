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
  type LucideIcon,
  Sparkles,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { UsageSection } from "@/components/billing/usage-section";
import {
  ensureOrgBillingAdmin,
  getOrgEntitlement,
  getOrgPortalUrl,
  NotBillingAdminError,
  startOrgCheckout,
} from "@/data/billing";
import { getOrgUsage, getOrgUsageSeries } from "@/data/usage";
import { authClient } from "@/lib/auth-client";
import { resolveUsagePeriod } from "@/lib/usage-period";

type Entitlement = Awaited<ReturnType<typeof getOrgEntitlement>>;

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_padded/billing",
)({
  staticData: { breadcrumb: "Billing", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Billing" }],
  }),
  beforeLoad: async () => {
    await ensureOrgBillingAdmin();
  },
  errorComponent: ({ error }) => {
    if (
      error instanceof NotBillingAdminError ||
      error.name === "NotBillingAdminError"
    ) {
      return <NotAdminMessage />;
    }
    throw error;
  },
  component: BillingPage,
});

function NotAdminMessage() {
  return (
    <div className="mx-auto w-full max-w-4xl">
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

const FREE_FEATURES = [
  "Unlimited repositories",
  "Unlimited local telemetry",
  "AI-native CLI and structured APIs",
  "Community support on Discord",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Premium support",
  "White-glove onboarding",
];

function BillingPage() {
  const { data: activeOrg } = authClient.useActiveOrganization();

  const entitlementQuery = useQuery({
    queryKey: ["billing", "entitlement", activeOrg?.id],
    enabled: Boolean(activeOrg?.id),
    queryFn: () => getOrgEntitlement(),
  });
  const entitlement = entitlementQuery.data;
  const period =
    !entitlementQuery.isError && entitlement
      ? resolveUsagePeriod(entitlement, new Date(entitlement.serverNow))
      : null;
  const from = period?.from.toISOString();
  const to = period?.to.toISOString();
  const usageEnabled = Boolean(
    !entitlementQuery.isError && activeOrg?.id && from && to,
  );

  const totalsQuery = useQuery({
    queryKey: ["billing", "usage", "totals", activeOrg?.id, from, to],
    enabled: usageEnabled,
    queryFn: async () => {
      if (!from || !to) return [];
      return getOrgUsage({ data: { from, to } });
    },
  });

  const seriesQuery = useQuery({
    queryKey: ["billing", "usage", "series", activeOrg?.id, from, to],
    enabled: usageEnabled,
    queryFn: async () => {
      if (!from || !to) return [];
      return getOrgUsageSeries({ data: { from, to } });
    },
  });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <Header orgName={activeOrg?.name} />
      {entitlementQuery.isError ? (
        <EntitlementError />
      ) : entitlement && period ? (
        <>
          <Body entitlement={entitlement} />
          <UsageSection
            tier={entitlement.tier}
            period={period}
            totals={totalsQuery.data}
            series={seriesQuery.data}
            totalsStatus={totalsQuery.status}
            seriesStatus={seriesQuery.status}
          />
        </>
      ) : (
        <Skeleton className="h-40 w-full rounded-xl" />
      )}
    </div>
  );
}

function EntitlementError() {
  return (
    <Card role="alert">
      <CardContent className="py-8 text-center">
        <p className="font-medium text-sm">Billing details are unavailable</p>
        <p className="text-muted-foreground text-sm">
          Try this page again in a moment.
        </p>
      </CardContent>
    </Card>
  );
}

function Body({ entitlement }: { entitlement: Entitlement }) {
  if (entitlement.tier === "pro") {
    return (
      <>
        <ProHero entitlement={entitlement} />
        <ManageBillingCard />
      </>
    );
  }
  return (
    <>
      <FreeHero />
      <PlanComparison />
    </>
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

function ProHero({ entitlement }: { entitlement: Entitlement }) {
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
                For teams who ship continuously and need deep signal.
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

function RedirectButton({
  mutationFn,
  variant,
  icon: Icon,
  label,
  loadingLabel,
}: {
  mutationFn: () => Promise<{ url: string }>;
  variant?: "default" | "outline";
  icon: LucideIcon;
  label: ReactNode;
  loadingLabel: ReactNode;
}) {
  const m = useMutation({
    mutationFn,
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
  const busy = m.isPending || m.isSuccess;
  return (
    <Button variant={variant} onClick={() => m.mutate()} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <Icon />}
      {busy ? loadingLabel : label}
      {!busy ? <ArrowUpRight /> : null}
    </Button>
  );
}

function UpgradeButton() {
  return (
    <RedirectButton
      mutationFn={() => startOrgCheckout({ data: { slug: "pro" } })}
      icon={Sparkles}
      label="Upgrade to Pro"
      loadingLabel="Starting checkout…"
    />
  );
}

function ManageBillingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Billing & invoices</CardTitle>
        <CardDescription>
          Update payment method, download invoices, or cancel your subscription.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RedirectButton
          mutationFn={() => getOrgPortalUrl()}
          variant="outline"
          icon={CreditCard}
          label="Open billing portal"
          loadingLabel="Opening portal…"
        />
      </CardContent>
    </Card>
  );
}
