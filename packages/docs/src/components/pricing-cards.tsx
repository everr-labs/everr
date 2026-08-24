import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, Check } from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

type DataRow = {
  signal: string;
  included: string;
  overage?: string;
};

type PlanCard = {
  id: "free" | "pro" | "enterprise";
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
    id: "free",
    name: "Free",
    price: "$0",
    unit: "/month",
    tagline: "For your side-project and trying things out",
    data: [
      { signal: "Logs", included: "5 GB" },
      { signal: "Traces", included: "5 GB" },
      { signal: "Metrics", included: "5 GB" },
      { signal: "Users", included: "3" },
    ],
    features: [
      "7-day logs and traces retention",
      "14-day metrics retention",
      "Max 5 Alerts",
      "Community support",
    ],
    cta: "Get started",
    href: "https://app.everr.dev",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$39",
    unit: "/month",
    tagline: "Start to get serious about observability",
    data: [
      { signal: "Logs", included: "100 GB", overage: "then $0.40 per GB" },
      { signal: "Traces", included: "100 GB", overage: "then $0.40 per GB" },
      { signal: "Metrics", included: "100 GB", overage: "then $0.40 per GB" },
      { signal: "Users", included: "3", overage: "then $8 per seat" },
    ],
    features: [
      "90-day logs and traces retention",
      "395-day metrics retention",
      "Unlimited alerts",
      "Priority support",
    ],
    cta: "Get started",
    href: "https://app.everr.dev",
    recommended: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "From $2,000",
    tagline:
      "Tailored pricing for high-volume teams with dedicated support and custom retention.",
    data: [
      { signal: "Logs", included: "Custom" },
      { signal: "Traces", included: "Custom" },
      { signal: "Metrics", included: "Custom" },
      { signal: "Users", included: "Custom" },
    ],
    features: [
      "Custom retention",
      "SSO / SAML",
      "Priority & dedicated support + SLA",
      "Hands-on help improving your OTel data",
      "Unlimited alerts",
    ],
    cta: "Talk to us",
    href: "https://calendar.app.google/XnYJ4rHuTzDaNetFA",
  },
];

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
            Best Pricing Everr.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            You should focus building, not into avoiding get caught in hidden
            cost traps.
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
                      {row.overage && (
                        <span className="mt-0.5 block font-mono text-[10px] text-fd-muted-foreground/60">
                          {row.overage}
                        </span>
                      )}
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
              <a
                href={card.href}
                className={cn(
                  "group mt-8 flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 font-heading text-sm font-bold tracking-tight outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
                  card.recommended
                    ? "bg-primary text-fd-background hover:bg-primary/90"
                    : "border-2 border-primary bg-transparent text-primary hover:bg-primary hover:text-fd-background",
                )}
              >
                {card.cta}
                <ArrowRight
                  className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                  strokeWidth={2.5}
                  aria-hidden
                />
              </a>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
