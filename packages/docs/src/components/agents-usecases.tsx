import { cn } from "@everr/ui/lib/utils";
import {
  Activity,
  LineChart,
  type LucideIcon,
  Search,
  ShieldCheck,
} from "lucide-react";
import { AnimatePresence, motion, useInView } from "motion/react";
import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

type Snippet = {
  /** The query the agent writes (the call). */
  call: ReactNode;
  /** The grounded response Everr returns. */
  response: ReactNode;
};

type UseCase = {
  id: string;
  /** Short tab label. */
  label: string;
  /** Icon shown in the tab + panel. */
  icon: LucideIcon;
  /** Panel title. */
  title: string;
  /** One-line plain description of what the agent does. */
  description: string;
  snippet: Snippet;
  /** Transparent reasoning: where the answer is grounded. */
  sources: string;
  /** Transparent reasoning: stated confidence. */
  confidence: string;
};

/* ------------------------------------------------------------------ */
/*  Snippet tokenizer — light, deterministic, no deps                  */
/* ------------------------------------------------------------------ */

/** Render a snippet line with faint key/value/string emphasis. */
function Tokenized({ children }: { children: string }) {
  // Split on quoted strings, keys (word before ":"), numbers, booleans.
  const parts = children.split(
    /("[^"]*"|\b[a-zA-Z_][\w]*(?=\s*:)|\b\d+\b|\btrue\b|\bfalse\b)/g,
  );
  return (
    <>
      {parts.map((part, i) => {
        if (part === "") return null;
        const key = `${i}-${part}`;
        if (/^"[^"]*"$/.test(part)) {
          return (
            <span key={key} className="text-fd-foreground">
              {part}
            </span>
          );
        }
        if (/^\d+$/.test(part)) {
          return (
            <span key={key} className="text-primary">
              {part}
            </span>
          );
        }
        if (part === "true" || part === "false") {
          return (
            <span key={key} className="text-primary">
              {part}
            </span>
          );
        }
        if (/^[a-zA-Z_][\w]*$/.test(part)) {
          return (
            <span key={key} className="text-fd-foreground/70">
              {part}
            </span>
          );
        }
        return (
          <span key={key} className="text-fd-muted-foreground/60">
            {part}
          </span>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Content (placeholder — each grounded in a real query)             */
/* ------------------------------------------------------------------ */

const USE_CASES: UseCase[] = [
  {
    id: "query-generation",
    label: "Query generation",
    icon: Activity,
    title: "Turn intent into a query",
    description:
      "The agent translates a plain goal into a real query, then reads the numbers back instead of guessing them.",
    snippet: {
      call: `everr.query({ service: "checkout", since: "15m", where: "status>=500" })`,
      response: `{ errors: 37, p99_ms: 1840 }`,
    },
    sources: "checkout · last 15m · 2.1M spans",
    confidence: "exact match · 0 sampled",
  },
  {
    id: "root-cause",
    label: "Root cause",
    icon: Search,
    title: "Walk a trace to the slow span",
    description:
      "Given a trace, the agent surfaces the single span that dominated the latency — with the why attached.",
    snippet: {
      call: `everr.query({ trace: "a3f9…", show: "slowest_span" })`,
      response: `{ span: "db.pool.acquire", ms: 1610, note: "pool exhausted" }`,
    },
    sources: "trace a3f9… · 41 spans · 1 root",
    confidence: "single trace · high",
  },
  {
    id: "anomaly",
    label: "Regression",
    icon: LineChart,
    title: "Compare two deploys",
    description:
      "The agent diffs a metric across versions and tells you, plainly, whether the new build regressed.",
    snippet: {
      call: `everr.query({ compare: "p99", deploy: ["v811", "v812"] })`,
      response: `{ v811: 240, v812: 1840, regressed: true }`,
    },
    sources: "p99 · v811 vs v812 · 1h window",
    confidence: "Δ +667% · significant",
  },
  {
    id: "dashboard-generation",
    label: "Dashboard",
    icon: ShieldCheck,
    title: "Scaffold a dashboard",
    description:
      "From one service name, the agent assembles a starter dashboard you can open, edit, and share.",
    snippet: {
      call: `everr.dashboard({ for: "checkout", panels: "auto" })`,
      response: `{ created: "checkout-overview", panels: 6 }`,
    },
    sources: "checkout · 6 signals detected",
    confidence: "draft · review before saving",
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export function AgentsUsecases() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const [active, setActive] = useState(0);
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = USE_CASES.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = index === last ? 0 : index + 1;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = index === 0 ? last : index - 1;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = last;
    }
    if (next !== null) {
      e.preventDefault();
      setActive(next);
      tabRefs.current[next]?.focus();
    }
  };

  const current = USE_CASES[active];
  const tabId = (i: number) => `${baseId}-tab-${i}`;
  const panelId = (i: number) => `${baseId}-panel-${i}`;

  return (
    <section
      ref={ref}
      className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background"
    >
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · usecases
      </span>

      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Built for agents
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Your coding agent asks Everr what really happened.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Instead of guessing from the code, it queries the same data your
            team and your CI already trust. Every answer comes back with the
            query that produced it — so you can check the work, not just the
            verdict.
          </p>
        </motion.div>

        {/* Explorer: tab rail + panel */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
          className="mt-14 grid grid-cols-1 gap-6 md:mt-20 md:grid-cols-[minmax(0,15rem)_1fr] md:gap-10"
        >
          {/* Tabs — horizontal scroll on mobile, vertical rail on md+ */}
          <div
            role="tablist"
            aria-label="What agents do with Everr"
            aria-orientation="vertical"
            className="-mx-6 flex snap-x snap-mandatory gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:flex-col md:gap-1.5 md:overflow-visible md:px-0 md:pb-0"
          >
            {USE_CASES.map((uc, i) => {
              const selected = i === active;
              const Icon = uc.icon;
              return (
                <button
                  key={uc.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={tabId(i)}
                  aria-selected={selected}
                  aria-controls={panelId(i)}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(i)}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                  className={cn(
                    "group relative flex shrink-0 snap-start items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background md:w-full",
                    selected
                      ? "border-fd-border bg-fd-card text-fd-foreground"
                      : "border-fd-border/50 bg-fd-card/30 text-fd-muted-foreground hover:border-fd-border hover:text-fd-foreground",
                  )}
                >
                  {/* lime active indicator — slides between tabs */}
                  {selected ? (
                    <motion.span
                      layoutId={`${baseId}-active-rail`}
                      transition={{ duration: 0.4, ease: EASE }}
                      className="absolute inset-y-2 left-0 hidden w-0.5 rounded-full bg-primary md:block"
                    />
                  ) : null}
                  {selected ? (
                    <motion.span
                      layoutId={`${baseId}-active-underline`}
                      transition={{ duration: 0.4, ease: EASE }}
                      className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary md:hidden"
                    />
                  ) : null}
                  <Icon
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      selected
                        ? "text-primary"
                        : "text-fd-muted-foreground/60 group-hover:text-fd-foreground",
                    )}
                  />
                  <span className="font-heading text-sm font-medium tracking-tight">
                    {uc.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Panel */}
          <div className="relative min-h-[24rem] rounded-2xl border border-fd-border bg-fd-card/30 p-6 sm:p-8 md:min-h-[22rem]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={current.id}
                role="tabpanel"
                id={panelId(active)}
                aria-labelledby={tabId(active)}
                tabIndex={0}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="flex flex-col gap-6 focus-visible:outline-none"
              >
                {/* Title + description */}
                <div>
                  <div className="flex items-center gap-2.5">
                    <current.icon
                      aria-hidden
                      className="size-4 shrink-0 text-primary"
                    />
                    <span className="font-heading text-[11px] font-bold uppercase tracking-[0.25em] text-fd-muted-foreground/60">
                      {current.label}
                    </span>
                  </div>
                  <h3 className="mt-3 font-heading text-xl tracking-tight text-fd-foreground sm:text-2xl">
                    {current.title}
                  </h3>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-fd-muted-foreground sm:text-base">
                    {current.description}
                  </p>
                </div>

                {/* Grounding snippet: query → response */}
                <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-background">
                  <div className="flex items-center gap-1.5 border-b border-fd-border px-4 py-2.5">
                    <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
                    <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
                    <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/50">
                      grounded query
                    </span>
                  </div>
                  <div className="overflow-x-auto px-4 py-4 font-mono text-xs leading-relaxed sm:text-[13px] [scrollbar-width:thin]">
                    <div className="flex gap-2.5 whitespace-pre">
                      <span
                        aria-hidden
                        className="shrink-0 select-none text-primary"
                      >
                        →
                      </span>
                      <code>
                        <Tokenized>{current.snippet.call as string}</Tokenized>
                      </code>
                    </div>
                    <div className="mt-2.5 flex gap-2.5 whitespace-pre">
                      <span
                        aria-hidden
                        className="shrink-0 select-none text-fd-muted-foreground/40"
                      >
                        ←
                      </span>
                      <code>
                        <Tokenized>
                          {current.snippet.response as string}
                        </Tokenized>
                      </code>
                    </div>
                  </div>
                </div>

                {/* Transparent reasoning meta */}
                <dl className="flex flex-col gap-x-8 gap-y-2 border-t border-fd-border/60 pt-4 font-mono text-[11px] sm:flex-row sm:flex-wrap">
                  <div className="flex items-center gap-2">
                    <dt className="uppercase tracking-[0.18em] text-fd-muted-foreground/40">
                      sources
                    </dt>
                    <dd className="text-fd-muted-foreground">
                      {current.sources}
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="uppercase tracking-[0.18em] text-fd-muted-foreground/40">
                      confidence
                    </dt>
                    <dd className="text-fd-muted-foreground">
                      {current.confidence}
                    </dd>
                  </div>
                </dl>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Footer: shared-data line + CTA */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.7, delay: 0.35, ease: EASE }}
          className="mt-12 flex flex-col gap-6 border-t border-fd-border/60 pt-8 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="max-w-xl text-sm leading-relaxed text-fd-muted-foreground">
            <span className="text-fd-foreground">
              You, your CI, and your agents run the same queries against the
              same data.
            </span>{" "}
            Assistance you can audit — not autopilot.
          </p>
          <a
            href="/docs"
            className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-primary px-5 py-2.5 font-heading text-sm font-medium tracking-tight text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
          >
            See the query API
            <span aria-hidden>→</span>
          </a>
        </motion.div>
      </div>
    </section>
  );
}
