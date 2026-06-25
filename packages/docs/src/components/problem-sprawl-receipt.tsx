import { cn } from "@everr/ui/lib/utils";
import {
  ArrowRight,
  Clock,
  FileText,
  KeyRound,
  Layers,
  type LucideIcon,
  Minus,
  Plus,
  Receipt,
  RefreshCw,
} from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

/* ------------------------------------------------------------------ */
/*  Data                                                              */
/*                                                                    */
/*  Hard numbers: only the 72% / 23% CNCF stat is a real statistic.   */
/*  The receipt is an illustrative metaphor — its "amounts" are units */
/*  of toil (logins, languages, hours, switches), NOT invented money. */
/* ------------------------------------------------------------------ */

type LineItem = {
  icon: LucideIcon;
  /** what sprawl charges you */
  label: string;
  /** the "amount" — a unit of toil, right-aligned, tabular */
  amount: string;
  /** the unit, set smaller after the figure */
  unit: string;
};

const LINE_ITEMS: LineItem[] = [
  {
    icon: KeyRound,
    label: "Separate logins & dashboards",
    amount: "7",
    unit: "tabs",
  },
  {
    icon: FileText,
    label: "Query languages to learn",
    amount: "4",
    unit: "dialects",
  },
  {
    icon: RefreshCw,
    label: "Context switches per incident",
    amount: "12",
    unit: "jumps",
  },
  {
    icon: Clock,
    label: "Hours correlating signals by hand",
    amount: "3.5",
    unit: "hrs / wk",
  },
  {
    icon: Layers,
    label: "Onboarding ramp, per new tool",
    amount: "2",
    unit: "weeks",
  },
];

/** The three real costs — printed as the bottom line of the bill. */
const TOTAL_COSTS = [
  "Complexity",
  "Slow onboarding",
  "No unified strategy",
] as const;

const EASE = [0.22, 1, 0.36, 1] as const;

/* A dotted perforation rule used between receipt sections. */
const DOTTED_RULE =
  "h-px w-full bg-[repeating-linear-gradient(to_right,var(--color-fd-border)_0,var(--color-fd-border)_5px,transparent_5px,transparent_10px)]";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ProblemSprawlReceipt() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background">
      <div ref={ref} className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        {/* ---- Eyebrow + variant badge ---- */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
              The problem
            </p>
            <span className="inline-flex items-center rounded-full border border-fd-border bg-fd-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fd-muted-foreground/70">
              variant · receipt
            </span>
          </div>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Answering one question shouldn&rsquo;t take seven tools.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Every tool you add bills you in a currency that never shows up on an
            invoice — time, focus, and the seams between dashboards. Here is the
            tab nobody itemizes.
          </p>
        </motion.div>

        {/* ---- The grid: copy on the left, receipt artifact on the right ---- */}
        <div className="mt-14 grid grid-cols-1 items-start gap-12 md:mt-20 lg:grid-cols-[1fr_minmax(0,28rem)] lg:gap-16">
          {/* LEFT: the stat + the named costs */}
          <div className="flex flex-col gap-12 lg:pt-2">
            {/* Stat — the only hard numbers, sourced */}
            <motion.figure
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.8, delay: 0.1, ease: EASE }}
            >
              <div className="flex flex-wrap items-baseline gap-x-8 gap-y-4">
                <Figure value="72%" caption="run 1–9 tools" emphasis />
                <Figure value="23%" caption="run 10–15 tools" />
              </div>
              <figcaption className="mt-5 max-w-md text-sm leading-relaxed text-fd-muted-foreground">
                Almost every team is already paying this bill. Nearly a quarter
                run a small fleet of them.
              </figcaption>
              <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-fd-muted-foreground/45">
                Source · CNCF
              </p>
            </motion.figure>

            {/* The named, real costs — what the receipt sums to */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
              className="border-t border-fd-border pt-10"
            >
              <h3 className="max-w-md text-balance font-heading text-xl leading-tight tracking-tight text-fd-foreground sm:text-2xl">
                The count isn&rsquo;t the cost. The sprawl is.
              </h3>
              <dl className="mt-7 flex flex-col gap-6">
                {NAMED_COSTS.map((cost, i) => (
                  <motion.div
                    key={cost.title}
                    initial={{ opacity: 0, y: 14 }}
                    animate={inView ? { opacity: 1, y: 0 } : undefined}
                    transition={{
                      duration: 0.6,
                      delay: 0.4 + i * 0.1,
                      ease: EASE,
                    }}
                    className="flex gap-4"
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                    />
                    <div className="min-w-0">
                      <dt className="font-heading text-sm font-bold tracking-tight text-fd-foreground">
                        {cost.title}
                      </dt>
                      <dd className="mt-1 text-sm leading-relaxed text-fd-muted-foreground">
                        {cost.body}
                      </dd>
                    </div>
                  </motion.div>
                ))}
              </dl>
            </motion.div>
          </div>

          {/* RIGHT: the hero artifact — the receipt */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.85, delay: 0.15, ease: EASE }}
            className="mx-auto w-full max-w-md lg:sticky lg:top-24"
          >
            <Receipt_ inView={inView} />
            <p className="mt-5 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-fd-muted-foreground/45">
              The bill nobody itemizes — illustrative
            </p>
          </motion.div>
        </div>

        {/* ---- Resolution: one consolidated counter-statement ---- */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, delay: 0.55, ease: EASE }}
          className="mt-20 flex flex-col items-start gap-6 border-t border-fd-border pt-12 sm:flex-row sm:items-center sm:justify-between md:mt-28"
        >
          <div className="max-w-xl">
            <p className="text-balance font-heading text-xl leading-snug tracking-tight text-fd-foreground sm:text-2xl md:text-3xl">
              One system. <span className="text-primary">One bill.</span>
            </p>
            <p className="mt-3 font-mono text-xs leading-relaxed tracking-tight text-fd-muted-foreground sm:text-sm">
              dev{" "}
              <span className="text-primary" aria-hidden>
                →
              </span>{" "}
              agents{" "}
              <span className="text-primary" aria-hidden>
                →
              </span>{" "}
              CI{" "}
              <span className="text-primary" aria-hidden>
                →
              </span>{" "}
              prod. One pipeline, one query surface, nothing to reconcile by
              hand.
            </p>
          </div>
          <a
            href="/docs"
            className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-fd-border bg-fd-card/40 px-6 py-3 font-heading text-sm font-bold tracking-tight text-fd-foreground outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
          >
            See how it consolidates
            <ArrowRight
              className="h-4 w-4 text-primary transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </a>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Named costs — the real bottom line, in prose on the left          */
/* ------------------------------------------------------------------ */

const NAMED_COSTS = [
  {
    title: "Complexity compounds",
    body: "Every tool is one more thing to wire, secure, and keep in sync. The seams between them are where the time really goes.",
  },
  {
    title: "Onboarding slows to a crawl",
    body: "Each tool brings its own query language and quirks. New hires learn all of them before they can answer anything.",
  },
  {
    title: "No unified strategy",
    body: "When data lives in seven places, no single view is true. Teams stitch context by hand instead of trusting one source.",
  },
] as const;

/* ------------------------------------------------------------------ */
/*  Figure — a single big stat with a small caption                   */
/* ------------------------------------------------------------------ */

function Figure({
  value,
  caption,
  emphasis = false,
}: {
  value: string;
  caption: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span
        className={cn(
          "font-mono text-4xl font-bold leading-none tracking-tight tabular-nums sm:text-5xl",
          emphasis ? "text-primary" : "text-fd-foreground/90",
        )}
      >
        {value}
      </span>
      <span className="mt-2 font-heading text-xs font-bold uppercase tracking-[0.18em] text-fd-muted-foreground/70">
        {caption}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Receipt — the hero artifact                                       */
/*                                                                    */
/*  Dark "thermal receipt": a slightly lighter surface than the       */
/*  background, monospace throughout, dotted perforation rules, and a */
/*  rounded, bordered card so it reads clearly as one slip.           */
/* ------------------------------------------------------------------ */

function Receipt_({ inView }: { inView: boolean }) {
  return (
    <div className="relative">
      {/* The paper. Shadow + faint vertical sheen of a thermal slip. */}
      <div className="relative overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-2xl shadow-black/40">
        <div className="relative px-6 py-7 sm:px-8">
          {/* --- Header --- */}
          <header className="flex flex-col items-center text-center">
            <Receipt
              className="size-6 text-primary"
              strokeWidth={1.75}
              aria-hidden
            />
            <p className="mt-3 font-mono text-xs font-bold uppercase tracking-[0.28em] text-fd-foreground">
              Tool Sprawl
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/60">
              Statement of toil
            </p>
            <p className="mt-3 font-mono text-[10px] tracking-tight text-fd-muted-foreground/50">
              No.&nbsp;0007 · per engineer · recurring
            </p>
          </header>

          <div aria-hidden className={cn("my-6", DOTTED_RULE)} />

          {/* --- Column header --- */}
          <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/50">
            <span>Item</span>
            <span>Qty</span>
          </div>

          {/* --- Line items: print in top → bottom --- */}
          <ul className="mt-3 flex flex-col">
            {LINE_ITEMS.map((item, i) => {
              const Icon = item.icon;
              return (
                <motion.li
                  key={item.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={inView ? { opacity: 1, y: 0 } : undefined}
                  transition={{
                    duration: 0.45,
                    delay: 0.35 + i * 0.13,
                    ease: EASE,
                  }}
                  className="flex items-start justify-between gap-4 py-2.5"
                >
                  <span className="flex min-w-0 items-start gap-2.5">
                    <Icon
                      className="mt-0.5 size-3.5 shrink-0 text-fd-muted-foreground/55"
                      strokeWidth={2}
                      aria-hidden
                    />
                    <span className="font-mono text-[13px] leading-snug text-fd-foreground/90">
                      {item.label}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-1.5 text-right">
                    <span className="font-mono text-sm font-bold tabular-nums text-fd-foreground">
                      {item.amount}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fd-muted-foreground/50">
                      {item.unit}
                    </span>
                  </span>
                </motion.li>
              );
            })}
          </ul>

          <div aria-hidden className={cn("my-5", DOTTED_RULE)} />

          {/* --- Subtotal arithmetic, the punchline being "untrackable" --- */}
          <motion.dl
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : undefined}
            transition={{ duration: 0.5, delay: 1.1, ease: EASE }}
            className="flex flex-col gap-1.5 font-mono text-xs"
          >
            <div className="flex items-center justify-between text-fd-muted-foreground">
              <dt className="flex items-center gap-1.5">
                <Plus className="size-3" aria-hidden /> Per-tool overhead
              </dt>
              <dd className="tabular-nums">×&nbsp;7</dd>
            </div>
            <div className="flex items-center justify-between text-fd-muted-foreground">
              <dt className="flex items-center gap-1.5">
                <Minus className="size-3" aria-hidden /> Time you get back
              </dt>
              <dd className="tabular-nums">0</dd>
            </div>
          </motion.dl>

          {/* --- Total: a solid double rule, then the three real costs --- */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.55, delay: 1.25, ease: EASE }}
            className="mt-5"
          >
            <div aria-hidden className="h-0.5 w-full bg-fd-border" />
            <div className="flex items-start justify-between gap-4 pt-4">
              <span className="font-mono text-sm font-bold uppercase tracking-[0.18em] text-fd-foreground">
                Total
              </span>
              <ul className="flex flex-col items-end gap-1">
                {TOTAL_COSTS.map((cost) => (
                  <li
                    key={cost}
                    className="text-right font-mono text-[13px] font-bold leading-tight text-primary"
                  >
                    {cost}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>

          <div aria-hidden className={cn("my-6", DOTTED_RULE)} />

          {/* --- Footer: barcode + thank-you line --- */}
          <footer className="flex flex-col items-center gap-3">
            <Barcode />
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/50">
              Paid in time &amp; focus · no refunds
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

/* A faux barcode rendered from a fixed bit pattern — decorative only. */
const BARCODE_BARS = [
  3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 1, 1, 3, 1, 1, 2, 1, 3, 1, 1, 2, 2, 1, 1, 3, 1,
  1, 2, 1, 1, 3, 2, 1, 1, 2, 1,
] as const;

function Barcode() {
  return (
    <div className="flex h-9 items-end gap-[2px]" aria-hidden>
      {BARCODE_BARS.map((w, i) => (
        <span
          key={`${i}-${w}`}
          className={cn(
            "block h-full rounded-[0.5px]",
            i % 5 === 0 ? "bg-fd-muted-foreground/35" : "bg-fd-foreground/70",
          )}
          style={{ width: `${w}px` }}
        />
      ))}
    </div>
  );
}
