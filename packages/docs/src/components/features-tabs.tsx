import { cn } from "@everr/ui/lib/utils";
import {
  Activity,
  Bot,
  type LucideIcon,
  Search,
  Timer,
  Unplug,
  Waypoints,
} from "lucide-react";
import { AnimatePresence, motion, useInView } from "motion/react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type Feature = {
  id: string;
  label: string;
  title: string;
  blurb: string;
  icon: LucideIcon;
};

const FEATURES: Feature[] = [
  {
    id: "unified",
    label: "Unified telemetry",
    title: "Unified logs, traces & metrics",
    blurb:
      "One pipeline carries every signal — no stitching three vendors together to follow a single request.",
    icon: Waypoints,
  },
  {
    id: "query",
    label: "One query surface",
    title: "One query surface",
    blurb:
      "Ask across logs, traces and metrics with the same syntax. The answer is one query away, not three tabs.",
    icon: Search,
  },
  {
    id: "retention",
    label: "Tiered retention",
    title: "Tiered retention",
    blurb:
      "Keep hot data fast and cold data cheap. Set the curve once and forget about storage bills.",
    icon: Timer,
  },
  {
    id: "alerting",
    label: "Alerting & SLOs",
    title: "Alerting & SLOs",
    blurb:
      "Define objectives, burn-rate alerts and notifications next to the data they watch — no separate console.",
    icon: Activity,
  },
  {
    id: "open",
    label: "Open & portable",
    title: "Open & portable",
    blurb:
      "Built on OpenTelemetry end to end. Your instrumentation stays yours, with no lock-in to walk back later.",
    icon: Unplug,
  },
  {
    id: "agents",
    label: "Built for agents",
    title: "Built for agents",
    blurb:
      "A query layer your coding agents can drive directly, so they reason about real runtime behavior — not guesses.",
    icon: Bot,
  },
];

const EASE = [0.22, 1, 0.36, 1] as const;

export function FeaturesTabs() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Auto-advance: cycle tabs while in view, paused on hover/focus and skipped
  // entirely when the user prefers reduced motion.
  useEffect(() => {
    if (!inView || paused) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % FEATURES.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [inView, paused]);

  const tabId = useCallback((i: number) => `${baseId}-tab-${i}`, [baseId]);
  const panelId = useCallback((i: number) => `${baseId}-panel-${i}`, [baseId]);

  const focusTab = useCallback((i: number) => {
    setActive(i);
    tabRefs.current[i]?.focus();
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const count = FEATURES.length;
      switch (e.key) {
        case "ArrowDown":
        case "ArrowRight":
          e.preventDefault();
          focusTab((active + 1) % count);
          break;
        case "ArrowUp":
        case "ArrowLeft":
          e.preventDefault();
          focusTab((active - 1 + count) % count);
          break;
        case "Home":
          e.preventDefault();
          focusTab(0);
          break;
        case "End":
          e.preventDefault();
          focusTab(count - 1);
          break;
        default:
          break;
      }
    },
    [active, focusTab],
  );

  const feature = FEATURES[active];

  return (
    <section
      ref={ref}
      className="relative overflow-hidden border-y-2 border-fd-border bg-fd-background"
    >
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · tabs
      </span>

      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Capabilities
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Everything you need, behind one surface.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Switch between the building blocks that make up the platform. Each
            one is a first-class part of the same pipeline.
          </p>
        </motion.div>

        {/* Pause auto-advance while the user is interacting with the widget. */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
          className="mt-14 grid grid-cols-1 gap-8 md:mt-20 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:gap-12 lg:gap-16"
        >
          {/* Tab rail — horizontal scroll on mobile, vertical on md+ */}
          <div
            role="tablist"
            aria-label="Platform capabilities"
            aria-orientation="vertical"
            className={cn(
              "-mx-6 flex snap-x snap-mandatory gap-2 overflow-x-auto px-6 pb-2",
              "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              "md:mx-0 md:flex-col md:gap-1 md:overflow-visible md:px-0 md:pb-0",
            )}
          >
            {FEATURES.map((f, i) => {
              const selected = i === active;
              const Icon = f.icon;
              return (
                <button
                  type="button"
                  key={f.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  id={tabId(i)}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId(i)}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(i)}
                  onKeyDown={onKeyDown}
                  className={cn(
                    "group relative flex shrink-0 snap-start items-center gap-3 rounded-lg px-4 py-3 text-left",
                    "outline-none transition-colors duration-200",
                    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
                    selected
                      ? "text-fd-foreground"
                      : "text-fd-muted-foreground hover:text-fd-foreground",
                    "md:w-full",
                  )}
                >
                  {selected && (
                    <motion.span
                      layoutId={`${baseId}-indicator`}
                      transition={{ duration: 0.4, ease: EASE }}
                      className="absolute inset-0 rounded-lg border border-fd-border bg-fd-card/60"
                    />
                  )}
                  {selected && (
                    <motion.span
                      layoutId={`${baseId}-accent`}
                      transition={{ duration: 0.4, ease: EASE }}
                      className="absolute inset-x-4 -bottom-px h-0.5 rounded-full bg-primary md:inset-x-auto md:bottom-2 md:left-0 md:top-2 md:h-auto md:w-0.5"
                    />
                  )}
                  <Icon
                    aria-hidden
                    className={cn(
                      "relative z-10 size-4 shrink-0 transition-colors duration-200",
                      selected
                        ? "text-primary"
                        : "text-fd-muted-foreground/60 group-hover:text-fd-foreground",
                    )}
                  />
                  <span className="relative z-10 whitespace-nowrap font-heading text-sm font-bold tracking-tight">
                    {f.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Display panel */}
          <div className="relative min-w-0">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={feature.id}
                id={panelId(active)}
                role="tabpanel"
                aria-labelledby={tabId(active)}
                tabIndex={0}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.45, ease: EASE }}
                className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
              >
                <Shot label={feature.id} />
                <div className="mt-8">
                  <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-fd-muted-foreground/40">
                    {String(active + 1).padStart(2, "0")} /{" "}
                    {String(FEATURES.length).padStart(2, "0")}
                  </span>
                  <h3 className="mt-3 font-heading text-2xl font-bold tracking-tight text-fd-foreground sm:text-3xl">
                    {feature.title}
                  </h3>
                  <p className="mt-3 max-w-xl text-base leading-relaxed text-fd-muted-foreground">
                    {feature.blurb}
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Faux screenshot frame                                              */
/* ------------------------------------------------------------------ */

function Shot({ label }: { label: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card/30">
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-fd-border bg-fd-card/60 px-4 py-3">
        <span className="size-3 rounded-full bg-fd-muted-foreground/25" />
        <span className="size-3 rounded-full bg-fd-muted-foreground/25" />
        <span className="size-3 rounded-full bg-fd-muted-foreground/25" />
        <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/40">
          everr · {label}
        </span>
      </div>
      {/* Body */}
      <div
        className="relative flex aspect-video items-center justify-center"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in oklab, var(--color-fd-muted-foreground) 16%, transparent) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      >
        <span className="font-mono text-xs text-fd-muted-foreground/40">
          screenshot
        </span>
      </div>
    </div>
  );
}
