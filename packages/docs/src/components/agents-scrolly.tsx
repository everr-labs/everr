import { cn } from "@everr/ui/lib/utils";
import {
  ArrowUpRight,
  Bot,
  Check,
  type LucideIcon,
  Search,
  ShieldCheck,
  Terminal,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

type Line =
  | { kind: "prompt"; text: string }
  | { kind: "comment"; text: string }
  | { kind: "json"; text: string }
  | { kind: "out"; text: string }
  | { kind: "good"; text: string }
  | { kind: "bad"; text: string };

type Step = {
  id: string;
  label: string;
  icon: LucideIcon;
  title: string;
  body: string;
  /** Source/confidence note shown under the demo for this step. */
  note: string;
  /** Faux-terminal contents for this step. */
  lines: Line[];
};

const STEPS: Step[] = [
  {
    id: "ask",
    label: "Ask",
    icon: Search,
    title: "The agent asks Everr.",
    body: "Before it changes a line, the agent queries the same surface a human would open. No screen-scraping, no guessing from the code — a plain question about what production is doing right now.",
    note: "source · checkout service · last 15m window",
    lines: [
      { kind: "comment", text: "// agent investigates a failing deploy" },
      { kind: "prompt", text: "everr.query({" },
      { kind: "prompt", text: '  service: "checkout",' },
      { kind: "prompt", text: '  since: "15m",' },
      { kind: "prompt", text: '  where: "status >= 500",' },
      { kind: "prompt", text: "})" },
    ],
  },
  {
    id: "ground",
    label: "Ground truth",
    icon: Terminal,
    title: "Everr returns ground truth.",
    body: "Structured, machine-readable, the same numbers a human sees on the dashboard. Real error counts, real latency, the deploy that introduced them — facts to reason from, not vibes.",
    note: "confidence · high · 1,204 spans · 0 sampling gaps",
    lines: [
      { kind: "comment", text: "// response — same data the dashboard shows" },
      { kind: "json", text: "{" },
      { kind: "json", text: '  "errors": 37,' },
      { kind: "json", text: '  "p99_ms": 1840,' },
      { kind: "json", text: '  "deploy": "v812",' },
      { kind: "json", text: '  "top_span": "db.pool.acquire"' },
      { kind: "json", text: "}" },
    ],
  },
  {
    id: "act",
    label: "Act",
    icon: Wrench,
    title: "The agent acts on it.",
    body: "It traces the slow path to db.pool.acquire — the connection pool is starved under load. It proposes the fix and writes it, with the query that justifies the change attached for you to review.",
    note: "reasoning · slow span db.pool.acquire · pool exhausted",
    lines: [
      { kind: "comment", text: "// root cause: pool exhausted under load" },
      { kind: "out", text: "- pool: { max: 10 }" },
      { kind: "good", text: "+ pool: { max: 40 }" },
      {
        kind: "comment",
        text: "// proposed for review — assist, not autopilot",
      },
      { kind: "prompt", text: "$ git commit -m 'fix: widen db pool'" },
    ],
  },
  {
    id: "verify",
    label: "Verify",
    icon: ShieldCheck,
    title: "And it verifies.",
    body: "Same query, run again after the change ships. The agent checks its own work against reality — errors back to zero, p99 down to baseline. The loop closes on evidence, not optimism.",
    note: "verified · re-queried after deploy v813",
    lines: [
      { kind: "comment", text: "// re-query after deploy v813" },
      {
        kind: "out",
        text: 'everr.query({ service: "checkout", since: "15m" })',
      },
      { kind: "good", text: "✓ errors:  37  →  0" },
      { kind: "good", text: "✓ p99_ms:  1840 → 240" },
      { kind: "good", text: "✓ resolved" },
    ],
  },
];

/** Color + prefix per terminal line kind. */
function lineClass(kind: Line["kind"]) {
  switch (kind) {
    case "comment":
      return "text-fd-muted-foreground/50";
    case "prompt":
      return "text-fd-foreground";
    case "json":
      return "text-fd-muted-foreground";
    case "out":
      return "text-fd-muted-foreground/80";
    case "good":
      return "text-primary";
    case "bad":
      return "text-fd-muted-foreground line-through";
    default:
      return "text-fd-foreground";
  }
}

/** Faux terminal / console that renders one step's state. */
function DemoStage({ step }: { step: Step }) {
  const Icon = step.icon;
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-2xl shadow-black/40">
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-fd-border bg-fd-card/80 px-4 py-3">
        <span className="size-3 rounded-full border border-fd-border bg-fd-muted-foreground/20" />
        <span className="size-3 rounded-full border border-fd-border bg-fd-muted-foreground/20" />
        <span className="size-3 rounded-full border border-fd-border bg-fd-muted-foreground/20" />
        <span className="ml-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/50">
          <Bot className="size-3" aria-hidden />
          agent · everr
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/50">
          <Icon className="size-3 text-primary" aria-hidden />
          {step.label}
        </span>
      </div>

      {/* Terminal body */}
      <div className="min-h-[15rem] flex-1 overflow-x-auto px-4 py-4 font-mono text-[12px] leading-relaxed sm:px-5 sm:text-[13px]">
        <pre className="whitespace-pre">
          {step.lines.map((line, i) => (
            <div
              key={`${step.id}-${i}`}
              className={cn("min-w-0", lineClass(line.kind))}
            >
              {line.text || " "}
            </div>
          ))}
        </pre>
      </div>

      {/* Source / confidence footer */}
      <div className="border-t border-fd-border bg-fd-card/60 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-fd-muted-foreground/50">
        {step.note}
      </div>
    </div>
  );
}

/** Vertical progress rail (md+ only). */
function ProgressRail({ active }: { active: number }) {
  return (
    <ol className="hidden flex-col gap-3 md:flex" aria-hidden>
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-3">
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
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A single scroll chapter on the left column. */
function ChapterBlock({
  step,
  index,
  onActive,
}: {
  step: Step;
  index: number;
  onActive: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Active when the chapter's center sits in the middle band of the viewport.
  const inView = useInView(ref, { margin: "-45% 0px -45% 0px" });
  // Separate once-reveal so content is visible by default (incl. headless).
  const reveal = useInView(ref, { once: true, margin: "-20% 0px" });
  const Icon = step.icon;

  useEffect(() => {
    if (inView) onActive(index);
  }, [inView, index, onActive]);

  return (
    <div
      ref={ref}
      className="flex min-h-[58vh] flex-col justify-center py-12 md:min-h-[80vh] md:py-0"
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={reveal ? { opacity: 1, y: 0 } : undefined}
        transition={{ duration: 0.7, ease: EASE }}
        className={cn(
          "md:max-w-md md:transition-opacity md:duration-500",
          // Dim inactive chapters on md+ only; mobile stays fully readable.
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
            {String(STEPS.length).padStart(2, "0")}
          </span>
        </div>

        <h3 className="mt-6 text-balance font-heading text-2xl leading-tight tracking-tight text-fd-foreground sm:text-3xl">
          {step.title}
        </h3>
        <p className="mt-4 text-base leading-relaxed text-fd-muted-foreground">
          {step.body}
        </p>

        {/* Mobile-only inline demo — no sticky, no JS-gated visibility. */}
        <div className="mt-8 md:hidden">
          <DemoStage step={step} />
        </div>
      </motion.div>
    </div>
  );
}

export function AgentsScrolly() {
  const headRef = useRef<HTMLDivElement>(null);
  const headInView = useInView(headRef, { once: true, margin: "-15% 0px" });
  const [active, setActive] = useState(0);
  const activeStep = STEPS[active];

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
            Built for agents
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Your agents query what your code actually did.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Same queries, same data, same answers — whether a human, your CI, or
            a coding agent is asking. Scroll the investigation; the console on
            the right follows the agent through it.
          </p>
        </motion.div>

        {/* Scrolly grid */}
        <div className="mt-16 grid grid-cols-1 gap-12 md:mt-24 md:grid-cols-2 md:gap-16">
          {/* LEFT: tall narrative stack */}
          <div className="flex flex-col">
            {STEPS.map((step, i) => (
              <ChapterBlock
                key={step.id}
                step={step}
                index={i}
                onActive={setActive}
              />
            ))}
          </div>

          {/* RIGHT: pinned demo stage (md+ only) */}
          <div className="hidden md:block">
            <div className="sticky top-0 flex h-svh flex-col justify-center gap-8 py-24">
              <div className="relative w-full">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeStep.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.4, ease: EASE }}
                  >
                    <DemoStage step={activeStep} />
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Active caption + progress rail */}
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-fd-muted-foreground/50">
                    Step {String(active + 1).padStart(2, "0")} of{" "}
                    {String(STEPS.length).padStart(2, "0")}
                  </p>
                  <p className="mt-2 truncate font-heading text-sm font-bold text-fd-foreground">
                    {activeStep.title}
                  </p>
                </div>
                <ProgressRail active={active} />
              </div>
            </div>
          </div>
        </div>

        {/* Payoff + CTA */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15% 0px" }}
          transition={{ duration: 0.7, ease: EASE }}
          className="mt-20 flex flex-col items-start gap-6 border-t-2 border-fd-border pt-12 md:mt-28 md:flex-row md:items-center md:justify-between"
        >
          <p className="max-w-xl text-balance font-heading text-xl leading-snug tracking-tight text-fd-foreground sm:text-2xl">
            Every change comes with the query that justifies it. You stay in the
            loop — assist, not autopilot.
          </p>
          <a
            href="/docs"
            className={cn(
              "group inline-flex shrink-0 items-center gap-2 rounded-full border border-primary bg-primary px-6 py-3",
              "font-heading text-sm font-bold uppercase tracking-[0.15em] text-fd-background",
              "transition-transform duration-300 hover:-translate-y-0.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
            )}
          >
            <Check className="size-4" aria-hidden />
            Wire up your agent
            <ArrowUpRight
              className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              aria-hidden
            />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
