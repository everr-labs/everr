import { cn } from "@everr/ui/lib/utils";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  GitBranch,
  Infinity as InfinityIcon,
  Star,
  Terminal,
} from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

// Placeholder destination — wired to real routes when content is finalized.
const HREF = "/get-started";

const FREE_INCLUDES = [
  "All signals — logs, traces, metrics, errors",
  "Unlimited queries, unlimited retention you control",
  "Self-host anywhere — laptop, cluster, air-gapped",
  "Community support and a permissive license",
] as const;

export function PricingSingle() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section
      ref={ref}
      className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background"
    >
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · single
      </span>

      <BackdropGrid />

      <div className="relative mx-auto max-w-7xl px-6 py-24 md:py-36">
        {/* ---------------------------------------------------------- */}
        {/*  Centerpiece — the free, open-source core                  */}
        {/* ---------------------------------------------------------- */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-4xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Pricing
          </p>

          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1">
            <GitBranch className="size-3.5 text-primary" aria-hidden />
            <span className="font-heading text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
              Open source
            </span>
          </div>

          <h2 className="mt-6 font-heading text-3xl leading-[1.1] tracking-tight text-balance sm:text-4xl md:text-5xl lg:text-6xl">
            <span className="text-fd-foreground">The core is free.</span>{" "}
            <span className="text-fd-muted-foreground/60">Forever.</span>
          </h2>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            No seats, no per-signal metering, no pricing wall between you and
            your own data. Clone it, run it, ship it. The whole platform is open
            source and self-hostable — you only pay us when you'd rather not run
            it yourself.
          </p>
        </motion.div>

        {/* Price + checklist + primary CTA */}
        <div className="mt-14 grid gap-12 md:mt-16 md:grid-cols-[auto_1fr] md:gap-16">
          {/* Big price statement */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
            className="flex flex-col"
          >
            <div className="flex items-end gap-3">
              <span className="font-heading text-7xl font-bold leading-none tracking-tighter text-fd-foreground sm:text-8xl">
                $0
              </span>
              <span className="mb-2 flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.15em] text-fd-muted-foreground">
                <InfinityIcon className="size-4 text-primary" aria-hidden />
                forever
              </span>
            </div>

            <div className="mt-6 inline-flex w-fit items-center gap-2.5 rounded-md border border-fd-border bg-fd-card/40 px-3 py-2">
              <Terminal
                className="size-4 shrink-0 text-fd-muted-foreground"
                aria-hidden
              />
              <code className="font-mono text-xs text-fd-foreground sm:text-sm">
                npx everr init
              </code>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row md:flex-col lg:flex-row">
              <PrimaryButton href={HREF}>
                Deploy the open-source core
                <ArrowRight
                  className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </PrimaryButton>
              <GhostButton href={HREF}>
                <Star className="size-4" aria-hidden />
                Star on GitHub
              </GhostButton>
            </div>
          </motion.div>

          {/* What "free" includes */}
          <motion.ul
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.7, delay: 0.25, ease: EASE }}
            className="grid gap-px self-center overflow-hidden rounded-lg border border-fd-border bg-fd-border sm:grid-cols-2"
          >
            {FREE_INCLUDES.map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 bg-fd-background px-5 py-5"
              >
                <span
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10"
                  aria-hidden
                >
                  <Check className="size-3 text-primary" strokeWidth={3} />
                </span>
                <span className="text-sm leading-relaxed text-fd-foreground">
                  {item}
                </span>
              </li>
            ))}
          </motion.ul>
        </div>

        {/* ---------------------------------------------------------- */}
        {/*  The single upgrade path — managed Cloud                   */}
        {/* ---------------------------------------------------------- */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.7, delay: 0.35, ease: EASE }}
          className="mt-20 md:mt-28"
        >
          <div className="flex items-center gap-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-fd-muted-foreground/50">
              Don't want to run it?
            </span>
            <span className="h-px flex-1 bg-fd-border" />
          </div>

          <div className="mt-6 flex flex-col gap-8 rounded-xl border border-fd-border bg-fd-card/40 p-7 md:flex-row md:items-center md:justify-between md:gap-12 md:p-9">
            <div className="max-w-xl">
              <h3 className="font-heading text-xl font-bold tracking-tight text-fd-foreground sm:text-2xl">
                Everr Cloud
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground sm:text-base">
                Same platform, fully managed. Hosted ingestion, automatic
                upgrades, and backups — so your team gets the open-source core
                without the on-call rotation.
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-end md:flex-col md:items-end lg:flex-row lg:items-end">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-fd-muted-foreground">
                  from
                </span>
                <span className="font-heading text-3xl font-bold tracking-tight text-fd-foreground sm:text-4xl">
                  $20
                </span>
                <span className="font-mono text-xs text-fd-muted-foreground">
                  /mo
                </span>
              </div>
              <PrimaryButton href={HREF}>
                Start on Cloud
                <ArrowUpRight
                  className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  aria-hidden
                />
              </PrimaryButton>
            </div>
          </div>

          {/* Enterprise — single understated line */}
          <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fd-muted-foreground">
            <span>
              Need SSO, audit logs, or a private deployment with an SLA?
            </span>
            <a
              href={HREF}
              className="group inline-flex items-center gap-1 rounded-sm font-heading font-bold text-fd-foreground underline decoration-fd-border decoration-1 underline-offset-4 transition-colors hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
            >
              Talk to us
              <ArrowRight
                className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
                aria-hidden
              />
            </a>
          </p>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Buttons                                                            */
/* ------------------------------------------------------------------ */

function PrimaryButton({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="group inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 font-heading text-sm font-bold text-fd-background transition-[transform,opacity] duration-300 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background active:scale-[0.98]"
    >
      {children}
    </a>
  );
}

function GhostButton({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="group inline-flex items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-card/40 px-5 py-2.5 font-heading text-sm font-bold text-fd-foreground transition-colors duration-300 hover:border-fd-foreground/30 hover:bg-fd-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
    >
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/*  Decorative backdrop — faint dotted grid, masked to fade out        */
/* ------------------------------------------------------------------ */

function BackdropGrid() {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 opacity-[0.4]",
        "[background-image:radial-gradient(circle_at_center,var(--color-fd-border)_1px,transparent_1px)]",
        "[background-size:32px_32px]",
        "[mask-image:radial-gradient(ellipse_70%_60%_at_30%_0%,black,transparent_75%)]",
      )}
    />
  );
}
