import { cn } from "@everr/ui/lib/utils";
import { Activity, Bell, Bot, Database, Layers, Search } from "lucide-react";
import {
  type MotionValue,
  motion,
  useInView,
  useScroll,
  useTransform,
} from "motion/react";
import { useRef } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

type Feature = {
  icon: typeof Layers;
  kicker: string;
  title: string;
  body: string;
};

const FEATURES: Feature[] = [
  {
    icon: Layers,
    kicker: "Signals",
    title: "Unified logs, traces & metrics",
    body: "Every signal lands in one place with a shared schema. Pivot from a slow trace to the exact log line to the metric that flagged it — no tab-hopping, no copy-pasting trace IDs between four tools.",
  },
  {
    icon: Search,
    kicker: "Query",
    title: "One query surface",
    body: "Ask the same question across logs, traces, and metrics with a single expression language. The query an agent writes on your laptop is the query your teammate runs in production a continent away.",
  },
  {
    icon: Database,
    kicker: "Storage",
    title: "Tiered retention",
    body: "Hot data stays instant, cold data stays cheap, and you decide the cutover. Keep a week of full fidelity and a year of rollups without a spreadsheet to model the bill.",
  },
  {
    icon: Bell,
    kicker: "Reliability",
    title: "Alerting & SLOs",
    body: "Define objectives once and let burn-rate alerts do the math. Pages fire on real budget loss, not on every transient blip, so the on-call rotation stays sane.",
  },
  {
    icon: Bot,
    kicker: "Agents",
    title: "Built for agents",
    body: "A structured surface coding agents can read and write. They query ground truth before they guess, attach evidence to their changes, and hand the trail to the next agent in the loop.",
  },
];

export function FeaturesStack() {
  const sectionRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const headInView = useInView(headRef, { once: true, margin: "-15% 0px" });

  return (
    <section
      ref={sectionRef}
      className="relative border-y-2 border-fd-border bg-fd-background"
    >
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · stack
      </span>

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
            One platform, the whole stack.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Five capabilities, one surface. Scroll to watch them settle into
            place.
          </p>
        </motion.div>

        {/* Sticky stacking deck. No overflow clipping anywhere up the tree,
            so position: sticky works. Mobile degrades to a plain vertical
            list because sticky is disabled below md via the top utilities. */}
        <div className="mt-16 md:mt-24">
          {FEATURES.map((feature, i) => (
            <StackCard
              key={feature.title}
              feature={feature}
              index={i}
              total={FEATURES.length}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Stacking card                                                       */
/* ------------------------------------------------------------------ */

// Per-index sticky offsets. Each card pins a little lower than the last so a
// sliver of every settled card peeks above the incoming one — the deck look.
// On mobile the cards are static (relative), so these only matter at md+.
const STICKY_TOP = [
  "md:top-24",
  "md:top-[6.5rem]",
  "md:top-28",
  "md:top-[7.5rem]",
  "md:top-32",
];

function StackCard({
  feature,
  index,
  total,
}: {
  feature: Feature;
  index: number;
  total: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });

  // Drive a subtle scale + dim as the *next* card scrolls over this one, so
  // the card beneath visibly recedes. The card's top reaches viewport-top when
  // it pins; from there to fully overlapped we ease it down. Last card never
  // recedes (nothing stacks on top of it).
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 120px", "end 120px"],
  });
  const isLast = index === total - 1;
  const scale = useTransform(scrollYProgress, [0, 1], [1, isLast ? 1 : 0.92]);
  const dim = useTransform(scrollYProgress, [0, 1], [0, isLast ? 0 : 0.4]);

  return (
    <div
      ref={ref}
      className={cn(
        // relative on mobile (plain stack), sticky from md up (deck)
        "relative md:sticky",
        STICKY_TOP[index] ?? "md:top-32",
        // breathing room between cards so the stacking has scroll distance
        index > 0 && "mt-8 md:mt-16",
      )}
    >
      <StackCardInner
        feature={feature}
        index={index}
        inView={inView}
        scale={scale}
        dim={dim}
      />
    </div>
  );
}

function StackCardInner({
  feature,
  index,
  inView,
  scale,
  dim,
}: {
  feature: Feature;
  index: number;
  inView: boolean;
  scale: MotionValue<number>;
  dim: MotionValue<number>;
}) {
  const { icon: Icon, kicker, title, body } = feature;

  return (
    <motion.article
      initial={{ opacity: 0, y: 28 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.7, ease: EASE }}
      style={{ scale, transformOrigin: "center top" }}
      className="relative overflow-hidden rounded-3xl border border-fd-border bg-fd-card shadow-2xl shadow-black/20"
    >
      {/* Recede overlay — darkens the pinned card as the next slides over it.
          Pointer-events-none so it never blocks the Shot beneath. */}
      <motion.div
        aria-hidden
        style={{ opacity: dim }}
        className="pointer-events-none absolute inset-0 z-10 bg-fd-background"
      />

      <div className="grid items-center gap-8 p-6 sm:p-8 md:grid-cols-2 md:gap-12 md:p-12 lg:p-14">
        {/* Copy column */}
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-fd-border bg-fd-background text-fd-foreground">
              <Icon className="size-5" strokeWidth={1.5} aria-hidden />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-fd-muted-foreground/50">
              {String(index + 1).padStart(2, "0")} / {kicker}
            </span>
          </div>

          <h3 className="mt-6 text-balance font-heading text-2xl leading-[1.12] tracking-tight text-fd-foreground sm:text-3xl md:text-[2rem]">
            {title}
          </h3>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-fd-muted-foreground md:text-base">
            {body}
          </p>

          <div className="mt-7 flex items-center gap-2">
            <span className="h-px w-8 bg-primary" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/40">
              everr
            </span>
          </div>
        </div>

        {/* Screenshot column */}
        <Shot label={`${kicker.toLowerCase()}.everr`} />
      </div>
    </motion.article>
  );
}

/* ------------------------------------------------------------------ */
/*  Faux screenshot frame                                               */
/* ------------------------------------------------------------------ */

function Shot({ label }: { label: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-background/60">
      {/* window chrome */}
      <div className="flex h-8 items-center gap-1.5 border-b border-fd-border/70 bg-fd-card/60 px-3">
        <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
        <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
        <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
        <span className="ml-2 font-mono text-[10px] text-fd-muted-foreground/30">
          {label}
        </span>
      </div>
      {/* body */}
      <div
        className="relative flex aspect-video w-full items-center justify-center"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, var(--color-fd-border) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      >
        <Activity
          className="absolute size-10 text-fd-muted-foreground/10"
          strokeWidth={1}
          aria-hidden
        />
        <span className="relative font-mono text-xs text-fd-muted-foreground/40">
          screenshot
        </span>
      </div>
    </div>
  );
}
