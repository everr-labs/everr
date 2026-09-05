import { cn } from "@everr/ui/lib/utils";
import { Check, Minus } from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

type PlanId = "oss" | "cloud" | "enterprise";

type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  price: string;
  unit: string;
  cta: string;
  recommended?: boolean;
};

const PLANS: Plan[] = [
  {
    id: "oss",
    name: "Open Source",
    tagline: "Self-host, forever free",
    price: "$0",
    unit: "/ self-hosted",
    cta: "Get started",
  },
  {
    id: "cloud",
    name: "Cloud",
    tagline: "Usage-based, fully managed",
    price: "$49",
    unit: "/ mo + usage",
    cta: "Get started",
    recommended: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Compliance & scale",
    price: "Custom",
    unit: "/ annual",
    cta: "Talk to sales",
  },
];

/** A single cell value: a boolean check/dash, or a short text string. */
type Cell = boolean | string;

type Row = {
  label: string;
  hint?: string;
  values: Record<PlanId, Cell>;
};

type Group = {
  label: string;
  rows: Row[];
};

const GROUPS: Group[] = [
  {
    label: "Telemetry",
    rows: [
      {
        label: "Logs, traces & metrics",
        hint: "OpenTelemetry-native ingest",
        values: { oss: true, cloud: true, enterprise: true },
      },
      {
        label: "Retention",
        values: { oss: "7 days", cloud: "90 days", enterprise: "Custom" },
      },
      {
        label: "Query surface",
        hint: "ClickHouse-backed",
        values: { oss: "SQL", cloud: "SQL + UI", enterprise: "SQL + UI" },
      },
      {
        label: "Ingest volume",
        values: { oss: "Unlimited", cloud: "Metered", enterprise: "Committed" },
      },
    ],
  },
  {
    label: "Reliability",
    rows: [
      {
        label: "SLOs & error budgets",
        values: { oss: true, cloud: true, enterprise: true },
      },
      {
        label: "Alerting",
        values: { oss: "Basic", cloud: "Advanced", enterprise: "Advanced" },
      },
      {
        label: "On-call routing",
        values: { oss: false, cloud: true, enterprise: true },
      },
      {
        label: "Anomaly detection",
        values: { oss: false, cloud: true, enterprise: true },
      },
    ],
  },
  {
    label: "Security",
    rows: [
      {
        label: "SSO / SAML",
        values: { oss: false, cloud: true, enterprise: true },
      },
      {
        label: "Role-based access",
        values: { oss: "Basic", cloud: true, enterprise: "Granular" },
      },
      {
        label: "Audit log",
        values: { oss: false, cloud: "30 days", enterprise: "Custom" },
      },
      {
        label: "Data residency",
        values: { oss: "Self", cloud: false, enterprise: true },
      },
    ],
  },
  {
    label: "Support",
    rows: [
      {
        label: "Community",
        values: { oss: true, cloud: true, enterprise: true },
      },
      {
        label: "Priority support",
        values: { oss: false, cloud: true, enterprise: true },
      },
      {
        label: "Uptime SLA",
        values: { oss: false, cloud: "99.9%", enterprise: "99.99%" },
      },
      {
        label: "Dedicated engineer",
        values: { oss: false, cloud: false, enterprise: true },
      },
    ],
  },
];

const EASE = [0.22, 1, 0.36, 1] as const;

export function PricingMatrix() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background">
      <div ref={ref} className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        {/* Section intro */}
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
            Every feature, side by side.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            No asterisks, no surprise line items. Compare the whole platform
            feature-by-feature and pick the tier that fits — start free and
            self-hosted, scale into managed Cloud when you're ready.
          </p>
        </motion.div>

        {/* Comparison matrix */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, delay: 0.12, ease: EASE }}
          className="mt-14 md:mt-20"
        >
          <div className="-mx-6 overflow-x-auto px-6 pb-2 [scrollbar-width:thin] md:mx-0 md:px-0">
            <table className="w-full min-w-[680px] border-separate border-spacing-0 text-left">
              <colgroup>
                <col className="w-[34%] min-w-[200px]" />
                <col className="w-[22%]" />
                <col className="w-[22%]" />
                <col className="w-[22%]" />
              </colgroup>

              <PlanHeader />

              <tbody>
                {GROUPS.map((group, gi) => (
                  <GroupBlock
                    key={group.label}
                    group={group}
                    isFirst={gi === 0}
                  />
                ))}

                {/* CTA footer row */}
                <tr>
                  <td className="sticky left-0 z-10 bg-fd-background" />
                  {PLANS.map((plan) => (
                    <td
                      key={plan.id}
                      className={cn(
                        "border-t border-fd-border px-4 py-6 align-top md:px-6",
                        plan.recommended && "bg-primary/[0.04]",
                      )}
                    >
                      <PlanCta plan={plan} />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-fd-muted-foreground/50">
            Prices shown are illustrative.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

function PlanHeader() {
  return (
    <thead className="sticky top-0 z-20">
      <tr>
        {/* Top-left label cell */}
        <th
          scope="col"
          className="sticky left-0 z-30 border-b border-fd-border bg-fd-background px-4 py-5 align-bottom md:px-6"
        >
          <span className="font-heading text-[11px] font-bold uppercase tracking-[0.25em] text-fd-muted-foreground/50">
            Compare plans
          </span>
        </th>

        {PLANS.map((plan) => (
          <th
            key={plan.id}
            scope="col"
            className={cn(
              "border-b border-fd-border bg-fd-background px-4 py-5 align-top md:px-6",
              plan.recommended &&
                "border-t-2 border-t-primary bg-primary/[0.06]",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="font-heading text-base font-bold text-fd-foreground md:text-lg">
                {plan.name}
              </span>
              {plan.recommended && (
                <span className="rounded-full bg-primary px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-fd-background">
                  Best value
                </span>
              )}
            </div>

            <p className="mt-1 hidden text-[13px] leading-snug text-fd-muted-foreground sm:block">
              {plan.tagline}
            </p>

            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-bold tracking-tight text-fd-foreground md:text-3xl">
                {plan.price}
              </span>
              <span className="font-mono text-[11px] text-fd-muted-foreground/70">
                {plan.unit}
              </span>
            </div>
          </th>
        ))}
      </tr>
    </thead>
  );
}

/* ------------------------------------------------------------------ */
/*  Group + rows                                                       */
/* ------------------------------------------------------------------ */

function GroupBlock({ group, isFirst }: { group: Group; isFirst: boolean }) {
  return (
    <>
      {/* Group header */}
      <tr>
        <th
          scope="colgroup"
          colSpan={4}
          className={cn(
            "sticky left-0 z-10 bg-fd-card/40 px-4 py-3 text-left md:px-6",
            !isFirst && "border-t border-fd-border",
          )}
        >
          <span className="font-heading text-[11px] font-bold uppercase tracking-[0.28em] text-fd-foreground/80">
            {group.label}
          </span>
        </th>
      </tr>

      {group.rows.map((row) => (
        <tr key={row.label} className="group">
          {/* Row label — pinned on horizontal scroll */}
          <th
            scope="row"
            className="sticky left-0 z-10 border-t border-fd-border/60 bg-fd-background px-4 py-4 text-left align-top font-normal md:px-6"
          >
            <span className="block text-sm leading-snug text-fd-foreground md:text-[15px]">
              {row.label}
            </span>
            {row.hint && (
              <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.12em] text-fd-muted-foreground/50">
                {row.hint}
              </span>
            )}
          </th>

          {PLANS.map((plan) => (
            <td
              key={plan.id}
              className={cn(
                "border-t border-fd-border/60 px-4 py-4 align-top text-sm transition-colors md:px-6",
                plan.recommended
                  ? "bg-primary/[0.04] group-hover:bg-primary/[0.07]"
                  : "group-hover:bg-fd-card/30",
              )}
            >
              <CellValue value={row.values[plan.id]} label={row.label} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Cell value                                                         */
/* ------------------------------------------------------------------ */

function CellValue({ value, label }: { value: Cell; label: string }) {
  if (value === true) {
    return (
      <>
        <Check
          aria-hidden
          className="size-[18px] text-primary"
          strokeWidth={2.5}
        />
        <span className="sr-only">{`${label}: included`}</span>
      </>
    );
  }

  if (value === false) {
    return (
      <>
        <Minus
          aria-hidden
          className="size-[18px] text-fd-muted-foreground/35"
          strokeWidth={2.5}
        />
        <span className="sr-only">{`${label}: not included`}</span>
      </>
    );
  }

  return (
    <span className="font-mono text-[13px] font-medium text-fd-foreground/90">
      {value}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  CTA                                                                */
/* ------------------------------------------------------------------ */

function PlanCta({ plan }: { plan: Plan }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex w-full items-center justify-center rounded-md px-4 py-2.5 font-heading text-[13px] font-bold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
        plan.recommended
          ? "bg-primary text-fd-background hover:bg-primary/90"
          : "border border-fd-border bg-fd-card/40 text-fd-foreground hover:border-fd-foreground/40 hover:bg-fd-card",
      )}
    >
      {plan.cta}
    </button>
  );
}
