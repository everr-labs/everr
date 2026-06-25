import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, Check, X } from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

type LedgerItem = {
  label: string;
  note: string;
};

const PAY_FOR: LedgerItem[] = [
  { label: "Managed ingest", note: "We run the pipeline so you don't." },
  {
    label: "Retention beyond 30 days",
    note: "Keep history as long as you need.",
  },
  { label: "Priority support", note: "Humans, on call, when it matters." },
  {
    label: "Single sign-on & audit",
    note: "The controls your security team asks for.",
  },
];

const NEVER_PAY: LedgerItem[] = [
  { label: "Per seat", note: "Invite the whole team. Invite their agents." },
  { label: "Per host", note: "Instrument everything. Count nothing." },
  { label: "Per dashboard", note: "Build a hundred. Build a thousand." },
  {
    label: "Query & egress fees",
    note: "Read your own data without a meter running.",
  },
  {
    label: "Data hostage",
    note: "Export anytime. Self-host anytime. Walk anytime.",
  },
];

export function PricingNarrative() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background">
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · narrative
      </span>

      <div ref={ref} className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        {/* Lead — confident transparency statement */}
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
            Pricing you can read in one sitting.
          </h2>
          <p className="mt-6 max-w-[65ch] text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            The core is open source — clone it, run it, keep it forever. Cloud
            is for the parts you'd rather not babysit. No surprise bills, no
            usage traps, no contract that punishes you for growing. If it ever
            stops earning its place, your data comes with you and the door is
            unlocked.
          </p>
        </motion.div>

        {/* The ledger */}
        <div className="mt-16 md:mt-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
            className="grid gap-x-16 gap-y-16 md:grid-cols-2"
          >
            <LedgerColumn
              kicker="What you pay for"
              lead="A short, finite list. Each line buys you back time."
              items={PAY_FOR}
              tone="pay"
              inView={inView}
              delayBase={0.25}
            />

            {/* Hairline divider between columns — full-width rule, not a side stripe */}
            <div className="relative md:before:absolute md:before:-left-8 md:before:top-1 md:before:bottom-1 md:before:w-px md:before:bg-fd-border">
              <LedgerColumn
                kicker="What you never pay for"
                lead="The industry's favorite gotchas. None of them live here."
                items={NEVER_PAY}
                tone="never"
                inView={inView}
                delayBase={0.35}
              />
            </div>
          </motion.div>
        </div>

        {/* Closing price line + CTA */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.7, delay: 0.7, ease: EASE }}
          className="mt-20 flex flex-col gap-8 border-t-2 border-fd-border pt-10 md:mt-28 md:flex-row md:items-end md:justify-between"
        >
          <div className="max-w-xl">
            <p className="font-heading text-2xl leading-tight tracking-tight text-fd-foreground sm:text-3xl">
              Free to self-host.{" "}
              <span className="text-fd-muted-foreground">
                Cloud from{" "}
                <span className="font-mono text-fd-foreground">$20</span>
                <span className="font-mono text-fd-muted-foreground">/mo</span>.
              </span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
              One plan, all features. Scale up when you want to, not because a
              line item forced you to.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/docs"
              className={cn(
                "group inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3",
                "font-heading text-sm font-bold uppercase tracking-[0.12em] text-fd-background",
                "transition-colors hover:bg-primary/90",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
              )}
            >
              Get started
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="/docs/pricing"
              className={cn(
                "inline-flex items-center gap-2 rounded-full border border-fd-border px-6 py-3",
                "font-heading text-sm font-bold uppercase tracking-[0.12em] text-fd-foreground",
                "transition-colors hover:border-fd-foreground/40 hover:bg-fd-card/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
              )}
            >
              Read the pricing docs
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function LedgerColumn({
  kicker,
  lead,
  items,
  tone,
  inView,
  delayBase,
}: {
  kicker: string;
  lead: string;
  items: LedgerItem[];
  tone: "pay" | "never";
  inView: boolean;
  delayBase: number;
}) {
  return (
    <div>
      <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
        {kicker}
      </p>
      <p className="mt-3 max-w-[42ch] text-sm leading-relaxed text-fd-muted-foreground">
        {lead}
      </p>

      <ul className="mt-8 flex flex-col">
        {items.map((item, i) => (
          <motion.li
            key={item.label}
            initial={{ opacity: 0, y: 12 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{
              duration: 0.6,
              delay: delayBase + i * 0.08,
              ease: EASE,
            }}
            className="flex items-baseline gap-4 border-t border-fd-border/60 py-4 first:border-t-0 first:pt-0"
          >
            <LedgerMark tone={tone} />
            <div className="min-w-0">
              <span
                className={cn(
                  "font-heading text-base font-bold tracking-tight",
                  tone === "pay"
                    ? "text-fd-foreground"
                    : "text-fd-muted-foreground line-through decoration-fd-border decoration-1",
                )}
              >
                {item.label}
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-fd-muted-foreground">
                {item.note}
              </span>
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function LedgerMark({ tone }: { tone: "pay" | "never" }) {
  if (tone === "pay") {
    return (
      <span
        aria-hidden
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/40 text-primary"
      >
        <Check className="size-3" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-fd-border text-fd-muted-foreground/50"
    >
      <X className="size-3" strokeWidth={2.5} />
    </span>
  );
}
