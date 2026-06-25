import { cn } from "@everr/ui/lib/utils";
import {
  Bell,
  Bot,
  Layers,
  type LucideIcon,
  Search,
  Timer,
} from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

type Feature = {
  index: string;
  icon: LucideIcon;
  label: string;
  title: string;
  body: string;
  points: string[];
};

const FEATURES: Feature[] = [
  {
    index: "01",
    icon: Layers,
    label: "Signals",
    title: "Unified logs, traces & metrics",
    body: "Every signal lands in one place, correlated by default. Jump from a spiking metric to the exact trace to the log line that explains it — no context switching, no copy-pasting IDs between four tabs.",
    points: [
      "OpenTelemetry-native ingest",
      "Auto-correlated by trace ID",
      "No agents to babysit",
    ],
  },
  {
    index: "02",
    icon: Search,
    label: "Query",
    title: "One query surface",
    body: "A single expressive language across all your telemetry. Write it once, run it against logs, traces, and metrics alike — the same syntax your agents already know how to generate.",
    points: [
      "Same grammar everywhere",
      "Sub-second over billions of rows",
      "Save, share, schedule",
    ],
  },
  {
    index: "03",
    icon: Timer,
    label: "Retention",
    title: "Tiered retention",
    body: "Keep hot data fast and cold data cheap. Recent windows stay instant; older data tiers down automatically so your bill tracks value, not volume — without ever losing the history you might need.",
    points: [
      "Hot / warm / cold tiers",
      "Per-stream policies",
      "Predictable spend",
    ],
  },
  {
    index: "04",
    icon: Bell,
    label: "Reliability",
    title: "Alerting & SLOs",
    body: "Define what good looks like, then let Everr watch it for you. Burn-rate alerts, error budgets, and multi-window SLOs that page the right human — or the right agent — before users notice.",
    points: [
      "Multi-window burn rates",
      "Error-budget tracking",
      "Route to humans or agents",
    ],
  },
  {
    index: "05",
    icon: Bot,
    label: "Agents",
    title: "Built for agents",
    body: "Your coding agents query Everr the way you do. Ground their decisions in real runtime behavior instead of guesses, and let every investigation compound into shared, reusable context.",
    points: [
      "Machine-readable query API",
      "Grounded in real behavior",
      "Shared session memory",
    ],
  },
];

const EASE = [0.22, 1, 0.36, 1] as const;

export function FeaturesZigzag() {
  const headRef = useRef<HTMLDivElement>(null);
  const headInView = useInView(headRef, { once: true, margin: "-15% 0px" });

  return (
    <section className="relative overflow-hidden border-y-2 border-fd-border bg-fd-background">
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        <motion.div
          ref={headRef}
          initial={{ opacity: 0, y: 24 }}
          animate={headInView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Capabilities
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Everything you need to see what your code actually does.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            One pipeline, one query surface, one bill — from the laptop to the
            cluster. A guided tour of the surface.
          </p>
        </motion.div>

        <div className="mt-20 flex flex-col gap-24 md:mt-32 md:gap-36">
          {FEATURES.map((feature, i) => (
            <FeatureRow
              key={feature.index}
              feature={feature}
              flip={i % 2 === 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureRow({ feature, flip }: { feature: Feature; flip: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });

  // Slide direction matches the side the text sits on: default rows have text
  // on the left (slide in from left → x:-32); flipped rows have text on the
  // right (slide in from right → x:32). The Shot mirrors the opposite side.
  const textFrom = flip ? 32 : -32;
  const shotFrom = flip ? -32 : 32;

  const Icon = feature.icon;

  return (
    <div
      ref={ref}
      className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16 lg:gap-20"
    >
      {/* TEXT — order-1 on mobile (reading order), positioned by flip on desktop */}
      <motion.div
        initial={{ opacity: 0, y: 24, x: textFrom }}
        animate={inView ? { opacity: 1, y: 0, x: 0 } : undefined}
        transition={{ duration: 0.8, ease: EASE }}
        className={cn(
          "order-1",
          flip ? "md:order-2 md:col-start-2" : "md:order-1 md:col-start-1",
        )}
      >
        <div className="flex items-baseline gap-4">
          <span className="font-heading text-5xl font-bold leading-none tracking-tight text-fd-muted-foreground/15 tabular-nums sm:text-6xl md:text-7xl">
            {feature.index}
          </span>
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-fd-muted-foreground/60">
            <Icon
              className="size-3.5 text-primary"
              strokeWidth={2}
              aria-hidden
            />
            {feature.label}
          </span>
        </div>

        <h3 className="mt-6 text-balance font-heading text-2xl leading-[1.15] tracking-tight text-fd-foreground sm:text-3xl md:text-4xl">
          {feature.title}
        </h3>

        <p className="mt-5 max-w-md text-base leading-relaxed text-fd-muted-foreground">
          {feature.body}
        </p>

        <ul className="mt-7 flex flex-col gap-3">
          {feature.points.map((point) => (
            <li
              key={point}
              className="flex items-center gap-3 text-sm text-fd-muted-foreground"
            >
              <span
                className="size-1.5 shrink-0 rounded-full bg-primary"
                aria-hidden
              />
              <span className="font-heading tracking-tight text-fd-foreground/90">
                {point}
              </span>
            </li>
          ))}
        </ul>
      </motion.div>

      {/* SHOT — order-2 on mobile (after text), positioned by flip on desktop */}
      <motion.div
        initial={{ opacity: 0, y: 24, x: shotFrom }}
        animate={inView ? { opacity: 1, y: 0, x: 0 } : undefined}
        transition={{ duration: 0.8, delay: 0.1, ease: EASE }}
        className={cn(
          "order-2",
          flip ? "md:order-1 md:col-start-1" : "md:order-2 md:col-start-2",
        )}
      >
        <Shot label={feature.label} />
      </motion.div>
    </div>
  );
}

function Shot({ label }: { label: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card/40 shadow-2xl shadow-black/30">
      {/* Faux window chrome */}
      <div className="flex items-center gap-2 border-b border-fd-border bg-fd-card/60 px-4 py-3">
        <span className="size-2.5 rounded-full border border-fd-border bg-fd-muted-foreground/20" />
        <span className="size-2.5 rounded-full border border-fd-border bg-fd-muted-foreground/20" />
        <span className="size-2.5 rounded-full border border-fd-border bg-fd-muted-foreground/20" />
        <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/40">
          everr · {label.toLowerCase()}
        </span>
      </div>

      {/* Body — empty but intentional: dot-grid + label */}
      <div
        className="relative flex aspect-video items-center justify-center"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--color-fd-border) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          backgroundPosition: "-1px -1px",
        }}
      >
        <span className="font-mono text-xs text-fd-muted-foreground/40">
          screenshot
        </span>
      </div>
    </div>
  );
}
