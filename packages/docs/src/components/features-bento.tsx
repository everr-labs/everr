import { cn } from "@everr/ui/lib/utils";
import {
  Bell,
  Bot,
  Boxes,
  Layers,
  type LucideIcon,
  Search,
  Unplug,
} from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

type Feature = {
  icon: LucideIcon;
  title: string;
  blurb: string;
};

const REVEAL = {
  initial: { opacity: 0, y: 24 },
  transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] as const },
};

/* ------------------------------------------------------------------ */
/*  Faux screenshot placeholder                                        */
/* ------------------------------------------------------------------ */

function Shot({
  label = "screenshot",
  ratio = "aspect-video",
  className,
}: {
  label?: string;
  ratio?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-fd-border bg-fd-background/60",
        className,
      )}
    >
      {/* window chrome */}
      <div className="flex h-8 items-center gap-1.5 border-b border-fd-border/70 bg-fd-card/60 px-3">
        <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
        <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
        <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
      </div>
      {/* body */}
      <div
        className={cn(
          "relative flex w-full items-center justify-center",
          ratio,
        )}
        style={{
          backgroundImage:
            "radial-gradient(circle at center, var(--color-fd-border) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      >
        <span className="font-mono text-xs text-fd-muted-foreground/40">
          {label}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cell shell                                                          */
/* ------------------------------------------------------------------ */

function Cell({
  index,
  inView,
  className,
  accent = false,
  children,
}: {
  index: number;
  inView: boolean;
  className?: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={REVEAL.initial}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ ...REVEAL.transition, delay: 0.1 + index * 0.08 }}
      className={cn(
        "group relative flex flex-col rounded-2xl border bg-fd-card/40 p-6 transition-all duration-300 hover:-translate-y-1 md:p-7",
        accent
          ? "border-primary/30 bg-primary/[0.06] hover:border-primary/50"
          : "border-fd-border hover:border-fd-border/80 hover:bg-fd-card/60",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

function FeatureHead({
  icon: Icon,
  title,
  blurb,
  accent = false,
}: Feature & { accent?: boolean }) {
  return (
    <>
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg border",
          accent
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-fd-border bg-fd-background/60 text-fd-foreground",
        )}
      >
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </div>
      <h3 className="mt-5 font-heading text-lg font-bold tracking-tight text-fd-foreground">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
        {blurb}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Content                                                             */
/* ------------------------------------------------------------------ */

const HERO: Feature = {
  icon: Layers,
  title: "Unified logs, traces & metrics",
  blurb:
    "Every signal lands in one place, correlated by default — no stitching across four disconnected tools to follow a single request.",
};

const WIDE: Feature = {
  icon: Search,
  title: "One query surface",
  blurb:
    "Ask once, in a language you already know, and get answers across every telemetry type without learning a new dialect per signal.",
};

const TALL: Feature = {
  icon: Bot,
  title: "Built for agents",
  blurb:
    "A query interface coding agents can drive themselves — so they reason from real runtime behavior instead of guessing.",
};

const SMALL: Feature[] = [
  {
    icon: Boxes,
    title: "Tiered retention",
    blurb: "Hot, warm, and cold storage tuned to spend, not guesswork.",
  },
  {
    icon: Bell,
    title: "Alerting & SLOs",
    blurb: "Define objectives, route alerts, and catch regressions early.",
  },
  {
    icon: Unplug,
    title: "Open & portable",
    blurb: "OpenTelemetry-native. No proprietary agents, no lock-in.",
  },
];

/* ------------------------------------------------------------------ */
/*  Section                                                             */
/* ------------------------------------------------------------------ */

export function FeaturesBento() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section
      ref={ref}
      className="relative overflow-hidden border-y-2 border-fd-border bg-fd-background"
    >
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · bento
      </span>

      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        <motion.div
          initial={REVEAL.initial}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={REVEAL.transition}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Capabilities
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Everything you need to see your system clearly.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            One pipeline, one query surface, one bill — across your laptop, your
            agents, your CI, and production.
          </p>
        </motion.div>

        {/* Bento grid */}
        <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 md:mt-20 md:grid-cols-4 md:auto-rows-[minmax(0,1fr)]">
          {/* Hero — 2×2 with large Shot */}
          <Cell
            index={0}
            inView={inView}
            className="sm:col-span-2 md:col-span-2 md:row-span-2"
          >
            <FeatureHead {...HERO} />
            <Shot
              label="unified.view"
              className="mt-6 flex-1"
              ratio="aspect-[16/10] md:aspect-auto md:h-full md:min-h-[14rem]"
            />
          </Cell>

          {/* Wide — 2×1 with Shot beside text */}
          <Cell
            index={1}
            inView={inView}
            className="sm:col-span-2 md:col-span-2"
          >
            <div className="flex flex-col gap-6 md:flex-row md:items-center">
              <div className="md:flex-1">
                <FeatureHead {...WIDE} />
              </div>
              <Shot
                label="query.surface"
                ratio="aspect-[16/9] md:aspect-[5/3]"
                className="w-full md:w-1/2"
              />
            </div>
          </Cell>

          {/* Tall — 1×2, accent-tinted, text-only */}
          <Cell index={2} inView={inView} accent className="md:row-span-2">
            <FeatureHead {...TALL} accent />
            <div className="mt-auto pt-8">
              <Shot
                label="agent.session"
                ratio="aspect-[4/3]"
                className="w-full"
              />
            </div>
          </Cell>

          {/* Three small text-only cells */}
          {SMALL.map((feature, i) => (
            <Cell key={feature.title} index={3 + i} inView={inView}>
              <FeatureHead {...feature} />
            </Cell>
          ))}
        </div>
      </div>
    </section>
  );
}
