import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, Layers, Minus } from "lucide-react";
import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

type LineItem = {
  label: string;
  note: string;
  price: number;
};

// Illustrative placeholder figures — monthly USD.
const BEFORE_ITEMS: LineItem[] = [
  { label: "Log management", note: "Ingest + retention", price: 1480 },
  { label: "APM / distributed tracing", note: "Per-host agents", price: 1120 },
  { label: "Metrics & time series", note: "Custom + DPM overage", price: 760 },
  {
    label: "Dashboards & visualization",
    note: "Per-seat licensing",
    price: 540,
  },
  { label: "On-call & alerting", note: "Per-responder", price: 420 },
];

const AFTER_ITEM: LineItem = {
  label: "Everr",
  note: "Logs, traces, metrics, dashboards & alerts",
  price: 690,
};

const BEFORE_TOTAL = BEFORE_ITEMS.reduce((sum, item) => sum + item.price, 0);
const AFTER_TOTAL = AFTER_ITEM.price;
const SAVINGS_ABS = BEFORE_TOTAL - AFTER_TOTAL;
const SAVINGS_PCT = Math.round((SAVINGS_ABS / BEFORE_TOTAL) * 100);
const MAX_PRICE = Math.max(...BEFORE_ITEMS.map((item) => item.price));

const usd = (value: number) => `$${value.toLocaleString("en-US")}`;

/** Count up to `target` once `active`, but render `target` immediately so the
 *  final figure is present without JS / for headless capture. */
function useCountUp(target: number, active: boolean, duration = 1100) {
  const [value, setValue] = useState(target);

  useEffect(() => {
    if (!active) return;
    setValue(0);
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setValue(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration]);

  return value;
}

export function PricingTco() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  const beforeCount = useCountUp(BEFORE_TOTAL, inView);
  const afterCount = useCountUp(AFTER_TOTAL, inView, 900);
  const savingsCount = useCountUp(SAVINGS_ABS, inView, 1300);

  return (
    <section
      ref={ref}
      className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background"
    >
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · tco
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
            Five line items, one invoice.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            The monthly TCO of a typical observability stack — log management,
            tracing, metrics, dashboards, alerting — collapsed into a single
            Everr bill. Same coverage, one vendor.
          </p>
        </motion.div>

        <div className="mt-14 grid items-stretch gap-8 md:mt-20 md:grid-cols-[1fr_auto_1fr] md:gap-6">
          {/* BEFORE — the stack */}
          <Panel
            inView={inView}
            delay={0.1}
            kicker="Today · separate tools"
            tone="muted"
          >
            <ul className="flex flex-col gap-4">
              {BEFORE_ITEMS.map((item, i) => (
                <LineRow
                  key={item.label}
                  item={item}
                  inView={inView}
                  index={i}
                  max={MAX_PRICE}
                  tone="muted"
                />
              ))}
            </ul>

            <TotalRow label="Monthly total" value={beforeCount} tone="muted" />
          </Panel>

          {/* Connector */}
          <div className="flex items-center justify-center md:flex-col">
            <motion.div
              initial={{ opacity: 0, scale: 0.6 }}
              animate={inView ? { opacity: 1, scale: 1 } : undefined}
              transition={{ duration: 0.5, delay: 0.55, ease: EASE }}
              className="flex size-12 items-center justify-center rounded-full border border-fd-border bg-fd-card text-fd-muted-foreground"
            >
              <ArrowRight className="size-5 md:hidden" aria-hidden />
              <ArrowRight
                className="hidden size-5 rotate-90 md:block"
                aria-hidden
              />
            </motion.div>
          </div>

          {/* AFTER — Everr */}
          <Panel
            inView={inView}
            delay={0.25}
            kicker="With Everr · one platform"
            tone="accent"
          >
            <div className="flex h-full flex-col">
              <ul className="flex flex-col gap-4">
                <LineRow
                  item={AFTER_ITEM}
                  inView={inView}
                  index={0}
                  max={MAX_PRICE}
                  tone="accent"
                />
              </ul>

              {/* Ghost rows that visualize the absorbed vendors */}
              <ul className="mt-4 flex flex-col gap-2.5" aria-hidden>
                {BEFORE_ITEMS.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center gap-2 text-xs text-fd-muted-foreground/45"
                  >
                    <Minus className="size-3 shrink-0 text-primary/60" />
                    <span className="font-heading tracking-tight line-through decoration-fd-muted-foreground/30">
                      {item.label}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-6">
                <TotalRow
                  label="Monthly total"
                  value={afterCount}
                  tone="accent"
                />
              </div>
            </div>
          </Panel>
        </div>

        {/* Conclusion — savings born from the comparison */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.7, delay: 0.7, ease: EASE }}
          className="mt-8 flex flex-col gap-6 rounded-2xl border-2 border-primary/30 bg-fd-card/40 p-6 sm:flex-row sm:items-center sm:justify-between md:mt-6 md:p-8"
        >
          <div className="flex items-baseline gap-4">
            <Layers
              className="hidden size-7 shrink-0 self-center text-primary sm:block"
              aria-hidden
            />
            <div>
              <p className="font-heading text-[11px] font-bold uppercase tracking-[0.25em] text-fd-muted-foreground/60">
                You keep
              </p>
              <p className="mt-1 font-mono text-4xl font-bold tabular-nums text-primary sm:text-5xl md:text-6xl">
                {usd(savingsCount)}
                <span className="ml-1 align-top text-base font-normal text-fd-muted-foreground sm:text-lg">
                  /mo
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5 sm:items-end">
            <p className="max-w-sm text-sm leading-relaxed text-fd-muted-foreground sm:text-right">
              That's{" "}
              <span className="font-mono font-bold text-fd-foreground">
                {SAVINGS_PCT}%
              </span>{" "}
              off your monthly observability TCO —{" "}
              <span className="text-fd-foreground">
                {usd(SAVINGS_ABS * 12)}
              </span>{" "}
              a year — with nothing left uncovered.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-heading text-sm font-bold text-fd-background transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
              >
                Get started
                <ArrowRight className="size-4" aria-hidden />
              </a>
              <a
                href="/pricing#tco"
                className="inline-flex items-center gap-2 rounded-full border border-fd-border px-5 py-2.5 font-heading text-sm font-bold text-fd-foreground transition-colors hover:border-fd-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
              >
                See the math
              </a>
            </div>
          </div>
        </motion.div>

        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-fd-muted-foreground/45">
          Illustrative monthly total cost of ownership · figures for comparison
          only
        </p>
      </div>
    </section>
  );
}

function Panel({
  children,
  inView,
  delay,
  kicker,
  tone,
}: {
  children: React.ReactNode;
  inView: boolean;
  delay: number;
  kicker: string;
  tone: "muted" | "accent";
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.7, delay, ease: EASE }}
      className={cn(
        "flex flex-col rounded-2xl border p-6 md:p-7",
        tone === "accent"
          ? "border-primary/40 bg-fd-card"
          : "border-fd-border bg-fd-card/30",
      )}
    >
      <p
        className={cn(
          "font-heading text-[11px] font-bold uppercase tracking-[0.25em]",
          tone === "accent" ? "text-primary" : "text-fd-muted-foreground/60",
        )}
      >
        {kicker}
      </p>
      <div className="mt-6 flex flex-1 flex-col">{children}</div>
    </motion.div>
  );
}

function LineRow({
  item,
  inView,
  index,
  max,
  tone,
}: {
  item: LineItem;
  inView: boolean;
  index: number;
  max: number;
  tone: "muted" | "accent";
}) {
  const widthPct = Math.max((item.price / max) * 100, 6);

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-bold tracking-tight text-fd-foreground">
            {item.label}
          </p>
          <p className="truncate text-xs text-fd-muted-foreground">
            {item.note}
          </p>
        </div>
        <p
          className={cn(
            "shrink-0 font-mono text-sm tabular-nums",
            tone === "accent" ? "text-primary" : "text-fd-foreground",
          )}
        >
          {usd(item.price)}
        </p>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-fd-border/40">
        <motion.div
          initial={{ width: 0 }}
          animate={inView ? { width: `${widthPct}%` } : undefined}
          style={!inView ? { width: `${widthPct}%` } : undefined}
          transition={{
            duration: 0.9,
            delay: 0.3 + index * 0.08,
            ease: EASE,
          }}
          className={cn(
            "h-full rounded-full",
            tone === "accent" ? "bg-primary" : "bg-fd-muted-foreground/55",
          )}
        />
      </div>
    </li>
  );
}

function TotalRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "accent";
}) {
  return (
    <div className="mt-6 flex items-end justify-between gap-4 border-t border-fd-border pt-5">
      <span className="font-heading text-[11px] font-bold uppercase tracking-[0.25em] text-fd-muted-foreground/60">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-3xl font-bold tabular-nums sm:text-4xl",
          tone === "accent" ? "text-primary" : "text-fd-foreground",
        )}
      >
        {usd(value)}
      </span>
    </div>
  );
}
