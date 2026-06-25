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
 * Per-signal portability is the honest core of this section: openness is
 * scoped deliberately and differently for each signal, never as a blanket
 * "portable" claim. Each tile names the exact open format and, where a format
 * is an acronym, glosses it inline rather than in a wall up top.
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
    icon: Gauge,
    signal: "Metrics",
    format: "PromQL",
    gloss: "Prometheus Query Language — the dialect you already write.",
  },
  {
    icon: Bell,
    signal: "Alerts",
    format: "Prometheus rules",
    gloss: "Standard alerting rules. Lift the YAML, drop it elsewhere.",
  },
  {
    icon: LineChart,
    signal: "Dashboards",
    format: "Perses",
    gloss: "The open, CNCF dashboard spec — versioned as plain files.",
  },
  {
    icon: Network,
    signal: "Traces",
    format: "OTLP export",
    gloss:
      "Raw OpenTelemetry Protocol — the standard wire format, streamed out.",
  },
  {
    icon: ScrollText,
    signal: "Logs",
    format: "OTLP export",
    gloss: "Same raw OTLP pipe. Nothing re-encoded into a private shape.",
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
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
              Open by default
            </p>
            <span className="inline-flex items-center rounded-full border border-fd-border bg-fd-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fd-muted-foreground/70">
              variant · bento
            </span>
          </div>

          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Your data stays in standard formats.{" "}
            <span className="text-primary">You&apos;re never locked in.</span>
          </h2>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Openness is the on-ramp, not the moat. We&apos;d rather you stay
            because leaving is easy — and staying is better.
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
          no exit tax
        </span>

        <h3 className="mt-5 max-w-md text-balance font-heading text-2xl leading-[1.12] tracking-tight text-fd-foreground sm:text-3xl">
          Built on open standards, top to bottom.
        </h3>

        <p className="mt-4 max-w-md text-sm leading-relaxed text-fd-muted-foreground sm:text-base">
          Every signal lands in a format the ecosystem already speaks — no
          proprietary store, no re-ingest tax, no hostage data. Walk in on your
          terms; walk out the same way.
        </p>
      </div>

      <p className="relative mt-8 max-w-md border-t border-fd-border pt-5 font-heading text-sm leading-snug text-fd-foreground/90">
        The door&apos;s unlocked on purpose.{" "}
        <span className="text-fd-muted-foreground">
          Most teams just stop looking for it.
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
            why staying is better
          </span>
        </div>

        <h3 className="mt-5 max-w-md text-balance font-heading text-xl leading-snug tracking-tight text-fd-foreground sm:text-2xl">
          Leaving is easy. Staying is the obvious call.
        </h3>

        <p className="mt-4 max-w-lg text-sm leading-relaxed text-fd-muted-foreground sm:text-base">
          What the open formats can&apos;t carry out the door is the part that
          matters: one unified semantic contract across every signal, and a
          single workflow that humans, CI, and coding agents all run against the
          same store. That&apos;s not exported — it&apos;s how the system
          thinks.
        </p>
      </div>

      <div className="mt-7 flex flex-wrap gap-2">
        {["unified semantic contract", "one shared workflow", "one store"].map(
          (chip) => (
            <span
              key={chip}
              className="inline-flex items-center gap-1.5 rounded-full border border-fd-border bg-fd-muted/40 px-3 py-1 font-mono text-[11px] tracking-tight text-fd-foreground/85"
            >
              <span className="size-1 rounded-full bg-primary" aria-hidden />
              {chip}
            </span>
          ),
        )}
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
      href="/docs/reference/portability"
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
          Compatibility matrix
        </p>
        <p className="mt-2 text-[13px] leading-snug text-fd-muted-foreground">
          The exact boundaries, in the open — including the Perses ↔ Grafana
          migration notes. Honest, because hiding them would be the lock-in.
        </p>
      </div>

      <span className="mt-5 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-fd-muted-foreground/70 transition-colors group-hover:text-primary">
        Read the matrix
        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </motion.a>
  );
}
