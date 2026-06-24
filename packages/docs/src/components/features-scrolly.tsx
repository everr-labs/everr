import { cn } from "@everr/ui/lib/utils";
import {
  Activity,
  Bot,
  Database,
  Layers,
  type LucideIcon,
  Search,
} from "lucide-react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

type Chapter = {
  id: string;
  label: string;
  icon: LucideIcon;
  title: string;
  body: string;
};

const CHAPTERS: Chapter[] = [
  {
    id: "unified",
    label: "Signals",
    icon: Layers,
    title: "Unified logs, traces & metrics",
    body: "Every signal lands in one place with a shared schema. Pivot from a slow trace to the exact log line to the metric that flagged it — no copy-pasting IDs between four disconnected tools.",
  },
  {
    id: "query",
    label: "Query",
    icon: Search,
    title: "One query surface",
    body: "A single expression language reads across all telemetry. Write it once, point it at logs, spans, or aggregates, and reuse the same filter in a dashboard, an alert, or an agent's investigation.",
  },
  {
    id: "retention",
    label: "Storage",
    icon: Database,
    title: "Tiered retention",
    body: "Keep recent data hot and queryable, roll older data into cheap columnar storage automatically. You decide the windows; Everr handles the lifecycle without dropping the fields you actually search on.",
  },
  {
    id: "alerting",
    label: "Reliability",
    icon: Activity,
    title: "Alerting & SLOs",
    body: "Define error budgets and burn-rate alerts on the same queries you explore with. Notifications carry the context — the failing query, the affected window, the trace that broke the budget.",
  },
  {
    id: "agents",
    label: "Agents",
    icon: Bot,
    title: "Built for agents",
    body: "Structured, queryable, machine-readable by default. Your coding agents read real runtime behavior instead of guessing — the same primitives a human uses, exposed through an interface an agent can drive.",
  },
];

const EASE = [0.22, 1, 0.36, 1] as const;

/** Faux app screenshot: window chrome + empty dot-grid stage. */
function Shot({
  chapter,
  className,
}: {
  chapter: Chapter;
  className?: string;
}) {
  const Icon = chapter.icon;
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-2xl shadow-black/40",
        className,
      )}
    >
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-fd-border bg-fd-card/80 px-4 py-3">
        <span className="size-3 rounded-full border border-fd-border bg-fd-muted-foreground/20" />
        <span className="size-3 rounded-full border border-fd-border bg-fd-muted-foreground/20" />
        <span className="size-3 rounded-full border border-fd-border bg-fd-muted-foreground/20" />
        <span className="ml-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/50">
          <Icon className="size-3" aria-hidden />
          {chapter.label}
        </span>
      </div>

      {/* Stage body */}
      <div
        className="relative flex aspect-video w-full flex-1 items-center justify-center"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--color-fd-border) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          backgroundPosition: "center",
        }}
      >
        <span className="font-mono text-xs text-fd-muted-foreground/40">
          screenshot
        </span>
      </div>
    </div>
  );
}

/** Vertical progress rail (md+ only). */
function ProgressRail({
  chapters,
  active,
}: {
  chapters: Chapter[];
  active: number;
}) {
  return (
    <ol className="hidden flex-col gap-3 md:flex" aria-hidden>
      {chapters.map((c, i) => (
        <li key={c.id} className="flex items-center gap-3">
          <span
            className={cn(
              "h-px w-6 transition-all duration-500",
              i === active ? "w-10 bg-primary" : "bg-fd-muted-foreground/30",
            )}
          />
          <span
            className={cn(
              "font-mono text-[10px] uppercase tracking-[0.2em] transition-colors duration-500",
              i === active
                ? "text-fd-foreground"
                : "text-fd-muted-foreground/40",
            )}
          >
            {c.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A single scroll chapter on the left column. */
function ChapterBlock({
  chapter,
  index,
  onActive,
}: {
  chapter: Chapter;
  index: number;
  onActive: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Activate when the chapter's center sits in the middle band of the viewport.
  const inView = useInView(ref, { margin: "-45% 0px -45% 0px" });
  const reveal = useInView(ref, { once: true, margin: "-20% 0px" });
  const Icon = chapter.icon;

  useEffect(() => {
    if (inView) onActive(index);
  }, [inView, index, onActive]);

  return (
    <div
      ref={ref}
      className="flex min-h-[60vh] flex-col justify-center py-12 md:min-h-[78vh] md:py-0"
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={reveal ? { opacity: 1, y: 0 } : undefined}
        transition={{ duration: 0.7, ease: EASE }}
        className={cn(
          "transition-opacity duration-500 md:max-w-md",
          // On md+ dim inactive chapters; on mobile everything stays readable.
          "md:opacity-40",
          inView && "md:opacity-100",
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-10 items-center justify-center rounded-lg border transition-colors duration-500",
              inView
                ? "border-primary/50 text-primary"
                : "border-fd-border text-fd-muted-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-fd-muted-foreground/50">
            {String(index + 1).padStart(2, "0")} /{" "}
            {String(CHAPTERS.length).padStart(2, "0")}
          </span>
        </div>

        <h3 className="mt-6 font-heading text-2xl leading-tight tracking-tight text-fd-foreground sm:text-3xl">
          {chapter.title}
        </h3>
        <p className="mt-4 text-base leading-relaxed text-fd-muted-foreground">
          {chapter.body}
        </p>

        {/* Mobile-only inline screenshot — no sticky, no JS-gated visibility. */}
        <div className="mt-8 md:hidden">
          <Shot chapter={chapter} />
        </div>
      </motion.div>
    </div>
  );
}

export function FeaturesScrolly() {
  const headRef = useRef<HTMLDivElement>(null);
  const headInView = useInView(headRef, { once: true, margin: "-15% 0px" });
  const [active, setActive] = useState(0);
  const activeChapter = CHAPTERS[active];

  return (
    <section className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background">
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · scrolly
      </span>

      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        {/* Header */}
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
            One platform, every signal.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Scroll through the surface area — from raw telemetry to alerts your
            agents can read. The stage on the right follows along.
          </p>
        </motion.div>

        {/* Scrolly grid */}
        <div className="mt-16 grid grid-cols-1 gap-12 md:mt-24 md:grid-cols-2 md:gap-16">
          {/* LEFT: tall narrative stack */}
          <div className="flex flex-col">
            {CHAPTERS.map((chapter, i) => (
              <ChapterBlock
                key={chapter.id}
                chapter={chapter}
                index={i}
                onActive={setActive}
              />
            ))}
          </div>

          {/* RIGHT: sticky media stage (md+ only) */}
          <div className="hidden md:block">
            <div className="sticky top-0 flex h-svh flex-col justify-center gap-8 py-24">
              <div className="relative aspect-video w-full">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeChapter.id}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.01 }}
                    transition={{ duration: 0.45, ease: EASE }}
                    className="absolute inset-0"
                  >
                    <Shot chapter={activeChapter} />
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Active caption + progress rail */}
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-fd-muted-foreground/50">
                    Now showing
                  </p>
                  <p className="mt-2 truncate font-heading text-sm font-bold text-fd-foreground">
                    {activeChapter.title}
                  </p>
                </div>
                <ProgressRail chapters={CHAPTERS} active={active} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
