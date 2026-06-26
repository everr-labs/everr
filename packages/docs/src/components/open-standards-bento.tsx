import { cn } from "@everr/ui/lib/utils";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Boxes,
  Gauge,
  LineChart,
  LockOpen,
  type LucideIcon,
  Network,
  ScrollText,
  Workflow,
} from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

/* ------------------------------------------------------------------ */
/*  Content                                                            */
/* ------------------------------------------------------------------ */

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Each tile names the open standard a signal actually uses — OpenTelemetry for
 * the signals themselves, Perses for dashboards, version-controlled YAML for
 * alerts. Where a format is an acronym, it's glossed inline.
 */
type Signal = {
  icon: LucideIcon;
  signal: string;
  /** The open format the signal speaks. Rendered in mono. */
  format: string;
  /** Inline gloss — what the format is / where it comes from. */
  gloss: string;
};

const SIGNALS: Signal[] = [
  {
    icon: Network,
    signal: "Traces",
    format: "OpenTelemetry",
    gloss: "Standard OTLP spans — the same model on your laptop and in prod.",
  },
  {
    icon: ScrollText,
    signal: "Logs",
    format: "OpenTelemetry",
    gloss: "Structured OTel logs over the same pipeline — nothing re-encoded.",
  },
  {
    icon: Gauge,
    signal: "Metrics",
    format: "OpenTelemetry",
    gloss: "OTel gauges, counters, and histograms over OTLP.",
  },
  {
    icon: LineChart,
    signal: "Dashboards",
    format: "Perses",
    gloss: "The open CNCF dashboard spec — versioned as plain files.",
  },
  {
    icon: Bell,
    signal: "Alerts",
    format: "As code (YAML)",
    gloss: "Query-driven alerts in version control, applied with everr apply.",
  },
];

/* ------------------------------------------------------------------ */
/*  Section                                                            */
/* ------------------------------------------------------------------ */

export function OpenStandardsBento() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background">
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        {/* Header */}
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Built on open standards
          </p>

          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Open standards, top to bottom.{" "}
            <span className="text-primary">Nothing proprietary to learn.</span>
          </h2>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Everr doesn&apos;t invent a private model. Your telemetry is
            OpenTelemetry, your dashboards and alerts are plain files, and you
            query all of it with SQL.
          </p>
        </motion.div>

        {/* Bento grid — deliberate asymmetry across 4 columns. */}
        <div className="mt-14 grid auto-rows-[minmax(0,1fr)] grid-cols-1 gap-4 sm:grid-cols-2 md:mt-20 lg:grid-cols-4">
          {/* Lead hero tile — spans 2 cols, carries the stance one-liner. */}
          <HeroTile inView={inView} index={0} className="lg:col-span-2" />

          {/* Stance tile — wide, the "why staying is better" payoff. */}
          <StanceTile inView={inView} index={1} className="lg:col-span-2" />

          {/* Five per-signal tiles — one open format each, scoped honestly. */}
          {SIGNALS.map((sig, i) => (
            <SignalTile
              key={sig.signal}
              signal={sig}
              inView={inView}
              index={2 + i}
            />
          ))}

          {/* Honest-boundary tile — links to the compatibility matrix. */}
          <BoundaryTile inView={inView} index={2 + SIGNALS.length} />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Tile primitives                                                    */
/* ------------------------------------------------------------------ */

const TILE_SURFACE =
  "rounded-xl border border-fd-border bg-fd-card/40 p-6 transition-colors duration-300";

/** Shared reveal wrapper — staggered by tile index. */
function Tile({
  inView,
  index,
  className,
  children,
}: {
  inView: boolean;
  index: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.7, delay: 0.08 + index * 0.07, ease: EASE }}
      className={cn(TILE_SURFACE, "group flex flex-col", className)}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero tile                                                          */
/* ------------------------------------------------------------------ */

function HeroTile({
  inView,
  index,
  className,
}: {
  inView: boolean;
  index: number;
  className?: string;
}) {
  return (
    <Tile
      inView={inView}
      index={index}
      className={cn(
        "relative justify-between overflow-hidden border-primary/30 bg-fd-card/60 sm:col-span-2 md:p-8",
        className,
      )}
    >
      {/* Subtle dot-grid wash — texture, not glass. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--color-fd-border) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          backgroundPosition: "-1px -1px",
          maskImage:
            "radial-gradient(120% 120% at 100% 0%, black 0%, transparent 65%)",
          WebkitMaskImage:
            "radial-gradient(120% 120% at 100% 0%, black 0%, transparent 65%)",
        }}
      />

      <div className="relative">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
          <LockOpen className="size-3" strokeWidth={2.25} aria-hidden />
          open formats
        </span>

        <h3 className="mt-5 max-w-md text-balance font-heading text-2xl leading-[1.12] tracking-tight text-fd-foreground sm:text-3xl">
          One standard model for every signal.
        </h3>

        <p className="mt-4 max-w-md text-sm leading-relaxed text-fd-muted-foreground sm:text-base">
          Traces, logs, and metrics are all OpenTelemetry. Dashboards follow the
          Perses spec, dashboards and alerts live in version control, and every
          query is plain SQL — formats the ecosystem already speaks.
        </p>
      </div>

      <p className="relative mt-8 max-w-md border-t border-fd-border pt-5 font-heading text-sm leading-snug text-fd-foreground/90">
        Nothing proprietary to learn.{" "}
        <span className="text-fd-muted-foreground">
          The formats are ones you already know.
        </span>
      </p>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Stance tile                                                        */
/* ------------------------------------------------------------------ */

function StanceTile({
  inView,
  index,
  className,
}: {
  inView: boolean;
  index: number;
  className?: string;
}) {
  return (
    <Tile
      inView={inView}
      index={index}
      className={cn("justify-between sm:col-span-2 md:p-8", className)}
    >
      <div>
        <div className="flex items-center gap-2.5">
          <Workflow
            className="size-4 text-primary"
            strokeWidth={2}
            aria-hidden
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fd-muted-foreground/60">
            one model, every signal
          </span>
        </div>

        <h3 className="mt-5 max-w-md text-balance font-heading text-xl leading-snug tracking-tight text-fd-foreground sm:text-2xl">
          One model across every signal.
        </h3>

        <p className="mt-4 max-w-lg text-sm leading-relaxed text-fd-muted-foreground sm:text-base">
          The real win isn&apos;t any single format — it&apos;s that humans, CI,
          and coding assistants all query the same store, the same way. One
          semantic model and one SQL surface, from your laptop to production.
        </p>
      </div>

      <div className="mt-7 flex flex-wrap gap-2">
        {["one semantic model", "one SQL surface", "one store"].map((chip) => (
          <span
            key={chip}
            className="inline-flex items-center gap-1.5 rounded-full border border-fd-border bg-fd-muted/40 px-3 py-1 font-mono text-[11px] tracking-tight text-fd-foreground/85"
          >
            <span className="size-1 rounded-full bg-primary" aria-hidden />
            {chip}
          </span>
        ))}
      </div>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Per-signal tile                                                    */
/* ------------------------------------------------------------------ */

function SignalTile({
  signal,
  inView,
  index,
}: {
  signal: Signal;
  inView: boolean;
  index: number;
}) {
  const Icon = signal.icon;
  return (
    <Tile
      inView={inView}
      index={index}
      className="justify-between hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg border border-fd-border bg-fd-background text-fd-muted-foreground transition-colors duration-300 group-hover:border-primary/50 group-hover:text-primary">
          <Icon className="size-4" strokeWidth={2} aria-hidden />
        </span>
        <span className="font-heading text-[10px] font-bold uppercase tracking-[0.25em] text-fd-muted-foreground/50">
          {signal.signal}
        </span>
      </div>

      <div className="mt-6">
        <p className="font-mono text-base font-medium tracking-tight text-fd-foreground">
          {signal.format}
        </p>
        <p className="mt-2 text-[13px] leading-snug text-fd-muted-foreground">
          {signal.gloss}
        </p>
      </div>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Honest-boundary / compatibility tile                              */
/* ------------------------------------------------------------------ */

function BoundaryTile({ inView, index }: { inView: boolean; index: number }) {
  return (
    <motion.a
      href="/docs/overview"
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.7, delay: 0.08 + index * 0.07, ease: EASE }}
      className={cn(
        TILE_SURFACE,
        "group flex flex-col justify-between border-dashed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background hover:border-primary/50 hover:bg-fd-card/60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg border border-fd-border bg-fd-background text-fd-muted-foreground transition-colors duration-300 group-hover:border-primary/50 group-hover:text-primary">
          <Boxes className="size-4" strokeWidth={2} aria-hidden />
        </span>
        <ArrowUpRight className="size-4 text-fd-muted-foreground/40 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
      </div>

      <div className="mt-6">
        <p className="font-heading text-sm font-bold tracking-tight text-fd-foreground">
          How it fits together
        </p>
        <p className="mt-2 text-[13px] leading-snug text-fd-muted-foreground">
          One OpenTelemetry pipeline across local, CI, and production — and how
          the same model follows your code everywhere.
        </p>
      </div>

      <span className="mt-5 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-fd-muted-foreground/70 transition-colors group-hover:text-primary">
        Read the overview
        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </motion.a>
  );
}
