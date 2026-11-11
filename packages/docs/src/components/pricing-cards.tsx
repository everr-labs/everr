import { cn } from "@everr/ui/lib/utils";
import { Check } from "lucide-react";
import { motion, useInView } from "motion/react";
import { type ReactNode, useRef } from "react";
import { Button } from "@/components/ui/button";
import { sectionLead, sectionWrap } from "@/components/ui/type";
import { SIGN_UP_URL } from "@/constants";
import { m } from "@/paraglide/messages";

const EASE = [0.22, 1, 0.36, 1] as const;

type Message = () => string;

type DataRow = {
  signal: Message;
  included: Message | string;
  overage?: Message;
};

type PlanCard = {
  id: "hobby" | "pro";
  name: string;
  price: string;
  tagline: Message;
  data: DataRow[];
  features: Message[];
  recommended?: boolean;
};

const CARDS: PlanCard[] = [
  {
    id: "hobby",
    name: "Hobby",
    price: "€0",
    tagline: m.pricing_hobby_tagline,
    data: [
      { signal: m.pricing_ingestion, included: m.pricing_hobby_ingestion },
      { signal: m.pricing_query_allowance, included: "5x", overage: m.pricing_hobby_scanned },
      { signal: m.pricing_users, included: "1" },
    ],
    features: [m.pricing_hobby_retention, m.pricing_hobby_alerts],
  },
  {
    id: "pro",
    name: "Pro",
    price: "€39",
    tagline: m.pricing_pro_tagline,
    data: [
      {
        signal: m.pricing_ingestion,
        included: m.pricing_pro_ingestion,
        overage: m.pricing_pro_overage,
      },
      { signal: m.pricing_query_allowance, included: "20x", overage: m.pricing_pro_scanned },
      { signal: m.pricing_users, included: m.pricing_pro_users },
    ],
    features: [m.pricing_pro_retention, m.pricing_pro_alerts, m.pricing_pro_org],
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
      nativeButton={false}
      render={
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- content is injected by Button
        <a href={href} />
      }
      className="w-full"
    >
      {children}
    </Button>
  );
}

const card = "relative flex flex-col rounded-3xl border p-7 sm:p-8";
const planName = "text-xl font-medium tracking-[-0.02em]";
const price = "display text-[3.5rem] tabular-nums md:text-[4rem]";
const groupLabel = "mt-8 border-t border-border pt-5 text-sm text-muted-foreground";

export function PricingCards() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });

  return (
    <section className="relative overflow-x-clip bg-background text-foreground">
      <div className={`${sectionWrap} pt-14 pb-20 md:pt-20 md:pb-28`}>
        <h1 className="display max-w-[12ch] text-[clamp(2.75rem,6.6vw,6.5rem)]">
          {m.pricing_heading()}
        </h1>
        <p className={`${sectionLead} mt-7 max-w-[52ch]`}>{m.pricing_lead()}</p>

        <div ref={ref} className="mt-14 grid gap-5 md:mt-20 lg:grid-cols-3">
          {CARDS.map((plan, i) => (
            <motion.article
              key={plan.id}
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.7, delay: 0.1 + i * 0.08, ease: EASE }}
              className={cn(
                card,
                plan.recommended ? "border-primary/60 bg-card" : "border-border bg-card/40",
              )}
            >
              <h2 className={planName}>{plan.name}</h2>
              <div className="mt-5 flex items-baseline gap-2">
                <span className={price}>{plan.price}</span>
                <span className="text-base text-muted-foreground">{m.pricing_per_month()}</span>
              </div>
              <p className="mt-4 text-[15px] leading-[1.55] text-muted-foreground lg:min-h-[2lh]">
                {plan.tagline()}
              </p>

              <p className={groupLabel}>{m.pricing_included()}</p>
              <dl className="mt-4 space-y-3">
                {plan.data.map((row) => (
                  <div key={row.signal()} className="flex items-baseline justify-between gap-4">
                    <dt className="text-[15px]">{row.signal()}</dt>
                    <dd className="text-right text-[15px] tabular-nums">
                      <span className="font-medium">
                        {typeof row.included === "string" ? row.included : row.included()}
                      </span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {row.overage?.()}&nbsp;
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>

              <p className={groupLabel}>{m.pricing_features()}</p>
              <ul className="mt-4 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature()} className="flex items-start gap-3 text-[15px]">
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-primary"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                    <span className="leading-snug">{feature()}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-9">
                <PricingCta href={SIGN_UP_URL} primary={plan.recommended}>
                  {m.get_started()}
                </PricingCta>
              </div>
            </motion.article>
          ))}
          <motion.article
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.7, delay: 0.26, ease: EASE }}
            className={cn(card, "border-border bg-card/40")}
          >
            <h2 className={planName}>Enterprise</h2>
            <p className={cn(price, "mt-5")}>{m.pricing_enterprise_price()}</p>
            <p className="mt-4 max-w-xs text-[15px] leading-[1.55] text-muted-foreground">
              {m.pricing_enterprise_body()}
            </p>
            <div className="mt-auto pt-12">
              <PricingCta href="https://calendar.app.google/kgnoxBsk4QyoLywG8">
                {m.pricing_enterprise_cta()}
              </PricingCta>
            </div>
          </motion.article>
        </div>
      </div>
    </section>
  );
}
