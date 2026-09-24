import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, Check } from "lucide-react";
import { motion, useInView } from "motion/react";
import { type ReactNode, useRef } from "react";
import { Button } from "@/components/ui/button";

const EASE = [0.22, 1, 0.36, 1] as const;

type DataRow = {
  signal: string;
  included: string;
  overage?: string;
};

type PlanCard = {
  id: "hobby" | "pro";
  name: string;
  price: string;
  unit?: string;
  tagline: string;
  data: DataRow[];
  features: string[];
  cta: string;
  href: string;
  recommended?: boolean;
};

const CARDS: PlanCard[] = [
  {
    id: "hobby",
    name: "Hobby",
    price: "€0",
    unit: "/month",
    tagline: "For personal projects and solo developers",
    data: [
      { signal: "Ingestion", included: "30 GB / month" },
      { signal: "Query allowance", included: "5x", overage: "150 GB scanned" },
      // { signal: "Uptime monitors", included: "1" },
      { signal: "Users", included: "1" },
    ],
    features: [
      "14-day retention",
      "5 alerts",
      // "1 uptime monitor",
    ],
    cta: "Get started",
    href: "https://app.everr.dev",
  },
  {
    id: "pro",
    name: "Pro",
    price: "€39",
    unit: "/ month",
    tagline: "More capacity and collaboration for growing teams",
    data: [
      {
        signal: "Ingestion",
        included: "300 GB / month",
        overage: "then €0.10 per GB",
      },
      { signal: "Query allowance", included: "20x", overage: "6 TB scanned" },
      // { signal: "Uptime monitors", included: "10", overage: "then €1 each" },
      { signal: "Users", included: "Unlimited" },
    ],
    features: [
      "12-month retention",
      "Unlimited alerts",
      "Organization management",
    ],
    cta: "Get started",
    href: "https://app.everr.dev",
    recommended: true,
  },
];

function PricingCta({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Button
      variant={primary ? "default" : "outline"}
      size="xl"
      nativeButton={false}
      render={
        // biome-ignore lint/a11y/useAnchorContent: content is injected by Button
        <a href={href} />
      }
      className="group w-full gap-2 font-heading text-sm font-bold tracking-tight"
    >
      {children}
      <ArrowRight
        className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
        strokeWidth={2.5}
        aria-hidden
      />
    </Button>
  );
}

export function PricingCards() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });

  return (
    <section className="relative overflow-x-clip bg-fd-background">
      <div ref={ref} className="mx-auto max-w-7xl px-6 pt-28 pb-16 md:pt-40">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <h1 className="text-balance font-heading text-4xl leading-[1.05] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
            Pricing that grows with you.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Start with a solo project, scale with your team, or contact us for
            higher volumes and dedicated instances.
          </p>
        </motion.div>

        {/* Tier cards */}
        <div className="mt-14 grid gap-6 md:mt-20 lg:grid-cols-3">
          {CARDS.map((card, i) => (
            <motion.article
              key={card.id}
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.7, delay: 0.1 + i * 0.08, ease: EASE }}
              className={cn(
                "relative flex flex-col rounded-2xl border p-8",
                card.recommended
                  ? "border-2 border-primary/50 bg-fd-card"
                  : "border-fd-border bg-fd-card/30",
              )}
            >
              {/* Header */}
              <span className="font-heading text-xs font-bold uppercase tracking-[0.25em] text-fd-muted-foreground">
                {card.name}
              </span>
              <div className="mt-4 flex items-end gap-2">
                <span className="font-mono text-4xl font-bold leading-none tracking-tight text-fd-foreground md:text-5xl">
                  {card.price}
                </span>
                {card.unit && (
                  <span className="pb-1 font-mono text-xs text-fd-muted-foreground/70">
                    {card.unit}
                  </span>
                )}
              </div>
              <p className="mt-4 text-sm leading-relaxed text-fd-muted-foreground">
                {card.tagline}
              </p>

              {/* Included */}
              <p className="mt-8 font-heading text-[11px] font-bold uppercase tracking-[0.2em] text-fd-muted-foreground/50">
                Included
              </p>
              <dl className="mt-4 space-y-3">
                {card.data.map((row) => (
                  <div
                    key={row.signal}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <dt className="text-sm text-fd-foreground">{row.signal}</dt>
                    <dd className="text-right">
                      <span className="font-mono text-sm font-medium text-fd-foreground">
                        {row.included}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-fd-muted-foreground/60">
                        {row.overage}&nbsp;
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>

              {/* Features */}
              <p className="mt-8 font-heading text-[11px] font-bold uppercase tracking-[0.2em] text-fd-muted-foreground/50">
                Features
              </p>
              <ul className="mt-4 flex-1 space-y-3">
                {card.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-3 text-sm text-fd-foreground"
                  >
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-primary"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                    <span className="leading-snug">{f}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <div className="mt-8">
                <PricingCta href={card.href} primary={card.recommended}>
                  {card.cta}
                </PricingCta>
              </div>
            </motion.article>
          ))}
          <motion.article
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.7, delay: 0.26, ease: EASE }}
            className="relative flex flex-col rounded-2xl border border-fd-border bg-fd-card/30 p-8"
          >
            <span className="font-heading text-xs font-bold uppercase tracking-[0.25em] text-fd-muted-foreground">
              Enterprise
            </span>
            <h2 className="mt-4 font-mono text-4xl font-bold leading-none tracking-tight text-fd-foreground md:text-5xl">
              Custom
            </h2>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-fd-muted-foreground">
              Higher volumes or dedicated instances? Let us build a plan around
              your needs.
            </p>
            <div className="mt-auto pt-12">
              <PricingCta href="https://calendar.app.google/XnYJ4rHuTzDaNetFA">
                Let's talk
              </PricingCta>
            </div>
          </motion.article>
        </div>
      </div>
    </section>
  );
}
