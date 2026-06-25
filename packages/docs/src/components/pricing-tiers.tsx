import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, Check, Minus } from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef, useState } from "react";

type Billing = "monthly" | "annual";

type Feature = { label: string; included: boolean };

type Tier = {
  name: string;
  tagline: string;
  /** Monthly price in dollars, or null for "custom". 0 = free. */
  monthly: number | null;
  /** Effective per-month price when billed annually. */
  annual: number | null;
  cta: string;
  recommended?: boolean;
  features: Feature[];
};

const TIERS: Tier[] = [
  {
    name: "Open Source",
    tagline: "Self-host the whole stack. Yours forever.",
    monthly: 0,
    annual: 0,
    cta: "Get started",
    features: [
      { label: "Logs, traces & metrics", included: true },
      { label: "Unlimited queries", included: true },
      { label: "7-day retention", included: true },
      { label: "Self-host", included: true },
      { label: "SLOs & alerting", included: false },
      { label: "SSO / RBAC", included: false },
      { label: "Priority support", included: false },
    ],
  },
  {
    name: "Cloud",
    tagline: "Managed, usage-based. Zero ops, full power.",
    monthly: 49,
    annual: 39,
    cta: "Get started",
    recommended: true,
    features: [
      { label: "Logs, traces & metrics", included: true },
      { label: "Unlimited queries", included: true },
      { label: "90-day retention", included: true },
      { label: "SLOs & alerting", included: true },
      { label: "SSO / RBAC", included: true },
      { label: "Self-host", included: false },
      { label: "Priority support", included: false },
    ],
  },
  {
    name: "Enterprise",
    tagline: "Dedicated infra, custom retention, white-glove.",
    monthly: null,
    annual: null,
    cta: "Talk to sales",
    features: [
      { label: "Everything in Cloud", included: true },
      { label: "Custom retention", included: true },
      { label: "SLOs & alerting", included: true },
      { label: "SSO / RBAC", included: true },
      { label: "Self-host or hybrid", included: true },
      { label: "Dedicated infra", included: true },
      { label: "Priority support", included: true },
    ],
  },
];

const EASE = [0.22, 1, 0.36, 1] as const;

function PriceDisplay({ tier, billing }: { tier: Tier; billing: Billing }) {
  const amount = billing === "annual" ? tier.annual : tier.monthly;

  if (amount === null) {
    return (
      <div className="flex items-baseline gap-2">
        <span className="font-heading text-5xl font-bold tracking-tight text-fd-foreground">
          Custom
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-mono text-2xl font-bold text-fd-muted-foreground">
        $
      </span>
      {/* Animate the number itself when the toggle flips. */}
      <span className="relative inline-flex overflow-hidden">
        <motion.span
          key={amount}
          initial={{ opacity: 0, y: "0.45em" }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className={cn(
            "font-heading text-5xl font-bold tracking-tight tabular-nums",
            tier.recommended ? "text-primary" : "text-fd-foreground",
          )}
        >
          {amount}
        </motion.span>
      </span>
      <span className="font-mono text-sm text-fd-muted-foreground">
        {amount === 0 ? "/ forever" : "/ mo"}
      </span>
    </div>
  );
}

function BillingToggle({
  billing,
  onChange,
}: {
  billing: Billing;
  onChange: (b: Billing) => void;
}) {
  const options: { id: Billing; label: string }[] = [
    { id: "monthly", label: "Monthly" },
    { id: "annual", label: "Annual" },
  ];

  return (
    <div className="inline-flex items-center gap-3">
      <div
        role="tablist"
        aria-label="Billing period"
        className="relative inline-flex rounded-full border border-fd-border bg-fd-card/60 p-1"
      >
        {options.map((opt) => {
          const active = billing === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(opt.id)}
              className={cn(
                "relative z-10 rounded-full px-5 py-2 font-heading text-xs font-bold uppercase tracking-[0.18em] outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
                active
                  ? "text-fd-background"
                  : "text-fd-muted-foreground hover:text-fd-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="billing-pill"
                  transition={{ duration: 0.4, ease: EASE }}
                  className="absolute inset-0 -z-10 rounded-full bg-primary"
                />
              )}
              {opt.label}
            </button>
          );
        })}
      </div>
      <span className="hidden font-mono text-[11px] uppercase tracking-[0.18em] text-primary sm:inline">
        Save ~20%
      </span>
    </div>
  );
}

function TierCard({
  tier,
  billing,
  index,
  inView,
}: {
  tier: Tier;
  billing: Billing;
  index: number;
  inView: boolean;
}) {
  const recommended = tier.recommended;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.7, delay: 0.1 + index * 0.12, ease: EASE }}
      className={cn(
        "relative flex flex-col rounded-2xl border p-8",
        recommended
          ? "border-primary bg-fd-card shadow-[0_0_0_1px_var(--color-primary)] md:-translate-y-3 md:scale-[1.015]"
          : "border-fd-border bg-fd-card/30",
      )}
    >
      {recommended && (
        <span className="absolute -top-3 left-8 inline-flex items-center rounded-full bg-primary px-3 py-1 font-heading text-[10px] font-bold uppercase tracking-[0.2em] text-fd-background">
          Most popular
        </span>
      )}

      <div>
        <h3 className="font-heading text-xl font-bold text-fd-foreground">
          {tier.name}
        </h3>
        <p className="mt-2 min-h-[2.5rem] text-sm leading-relaxed text-fd-muted-foreground">
          {tier.tagline}
        </p>
      </div>

      <div className="mt-6 border-t border-fd-border pt-6">
        <PriceDisplay tier={tier} billing={billing} />
        {tier.monthly !== null && tier.monthly > 0 && (
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fd-muted-foreground/70">
            {billing === "annual"
              ? "billed annually · per seat"
              : "billed monthly · per seat"}
          </p>
        )}
        {tier.monthly === 0 && (
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fd-muted-foreground/70">
            free · self-hosted
          </p>
        )}
        {tier.monthly === null && (
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fd-muted-foreground/70">
            volume pricing · annual
          </p>
        )}
      </div>

      <a
        href="#get-started"
        className={cn(
          "group mt-8 inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 font-heading text-sm font-bold tracking-tight outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
          recommended
            ? "bg-primary text-fd-background hover:bg-primary/90"
            : "border border-fd-border bg-transparent text-fd-foreground hover:border-fd-foreground/40 hover:bg-fd-card",
        )}
      >
        {tier.cta}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </a>

      <ul className="mt-8 space-y-3 border-t border-fd-border pt-8">
        {tier.features.map((feature) => (
          <li
            key={feature.label}
            className={cn(
              "flex items-start gap-3 text-sm",
              feature.included
                ? "text-fd-foreground"
                : "text-fd-muted-foreground/50",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center",
                feature.included
                  ? "text-primary"
                  : "text-fd-muted-foreground/40",
              )}
            >
              {feature.included ? (
                <Check className="size-4" strokeWidth={2.5} />
              ) : (
                <Minus className="size-4" strokeWidth={2.5} />
              )}
            </span>
            <span className={cn(!feature.included && "line-through")}>
              {feature.label}
            </span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

export function PricingTiers() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <section
      ref={ref}
      className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background"
    >
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · tiers
      </span>

      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Pricing
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            <span className="text-fd-foreground">
              Pay for the data, not the platform.
            </span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Start free and self-hosted, scale into a managed cloud when you stop
            wanting to babysit it, and go custom when the org demands it. One
            pipeline, three ways to run it.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
          className="mt-12"
        >
          <BillingToggle billing={billing} onChange={setBilling} />
        </motion.div>

        <div className="mt-10 grid grid-cols-1 gap-6 md:mt-14 md:grid-cols-3 md:items-start md:gap-5 lg:gap-6">
          {TIERS.map((tier, i) => (
            <TierCard
              key={tier.name}
              tier={tier}
              billing={billing}
              index={i}
              inView={inView}
            />
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : undefined}
          transition={{ duration: 0.7, delay: 0.6, ease: EASE }}
          className="mt-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-fd-muted-foreground/50"
        >
          Illustrative pricing · no credit card to self-host
        </motion.p>
      </div>
    </section>
  );
}
