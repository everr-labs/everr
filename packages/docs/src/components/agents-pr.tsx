import { cn } from "@everr/ui/lib/utils";
import {
  ArrowRight,
  Bot,
  Check,
  CircleCheck,
  GitMerge,
  GitPullRequest,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/*  Section                                                            */
/* ------------------------------------------------------------------ */

export function AgentsPr() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section
      ref={ref}
      className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background"
    >
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · pr
      </span>

      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:gap-16">
          {/* ---- Copy column ---- */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.8, ease: EASE }}
            className="lg:sticky lg:top-28"
          >
            <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
              Built for agents
            </p>
            <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
              The proof rides along with the change.
            </h2>
            <p className="mt-6 max-w-md text-base leading-relaxed text-fd-muted-foreground md:text-lg">
              When an agent opens a pull request, it doesn't guess. It queries
              Everr for what your software actually did — and pins the result
              right next to the diff. Humans and CI read the same evidence.
            </p>

            <ul className="mt-8 space-y-4">
              <CopyPoint icon={ShieldCheck}>
                Every claim is grounded in real telemetry — the query and its
                result are part of the review.
              </CopyPoint>
              <CopyPoint icon={MessageSquare}>
                Transparent reasoning: sources, the exact query, and a
                confidence note. No black box.
              </CopyPoint>
              <CopyPoint icon={GitMerge}>
                Assist, not autopilot. The agent proposes with evidence — a
                human still clicks merge.
              </CopyPoint>
            </ul>

            <div className="mt-10">
              <a
                href="/docs"
                className={cn(
                  "group inline-flex items-center gap-2 rounded-full border border-primary bg-primary px-6 py-3",
                  "font-heading text-sm font-bold uppercase tracking-[0.15em] text-fd-background",
                  "transition-colors hover:bg-primary/90",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
                )}
              >
                See how agents query Everr
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>
          </motion.div>

          {/* ---- PR card column ---- */}
          <PullRequestCard inView={inView} />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Copy bullet                                                        */
/* ------------------------------------------------------------------ */

function CopyPoint({
  icon: Icon,
  children,
}: {
  icon: typeof ShieldCheck;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-fd-border bg-fd-card/50 text-primary">
        <Icon className="size-3.5" />
      </span>
      <span className="text-sm leading-relaxed text-fd-muted-foreground">
        {children}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  PR card                                                            */
/* ------------------------------------------------------------------ */

function PullRequestCard({ inView }: { inView: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.8, delay: 0.1, ease: EASE }}
      className="overflow-hidden rounded-xl border border-fd-border bg-fd-card/60 shadow-2xl shadow-black/30 backdrop-blur-sm"
    >
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-fd-border bg-fd-card px-4 py-3">
        <span className="size-3 rounded-full border border-fd-border/80" />
        <span className="size-3 rounded-full border border-fd-border/80" />
        <span className="size-3 rounded-full border border-fd-border/80" />
        <span className="ml-3 truncate font-mono text-xs text-fd-muted-foreground">
          everr-labs/checkout · pull/4127
        </span>
      </div>

      {/* PR header */}
      <div className="border-b border-fd-border px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 font-heading text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
            <GitPullRequest className="size-3.5" />
            Open
          </span>
          <span className="font-mono text-[11px] text-fd-muted-foreground">
            #4127
          </span>
        </div>

        <h3 className="mt-3 font-heading text-lg leading-snug tracking-tight text-fd-foreground sm:text-xl">
          fix(checkout): raise db pool size to clear 5xx
        </h3>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fd-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="flex size-5 items-center justify-center rounded-full border border-primary/40 bg-fd-background text-primary">
              <Bot className="size-3" />
            </span>
            <span className="text-fd-foreground">everr-agent</span>
            <span>wants to merge into</span>
          </span>
          <span className="rounded border border-fd-border bg-fd-background px-1.5 py-0.5 font-mono text-[11px] text-fd-muted-foreground">
            main
          </span>
          <span>from</span>
          <span className="rounded border border-fd-border bg-fd-background px-1.5 py-0.5 font-mono text-[11px] text-fd-muted-foreground">
            agent/db-pool-5xx
          </span>
        </div>
      </div>

      {/* Diff hunk */}
      <DiffHunk />

      {/* Inline review comment (agent posts evidence) */}
      <ReviewComment inView={inView} />

      {/* CI checks block */}
      <ChecksBlock inView={inView} />

      {/* Merge footer (human approval) */}
      <MergeFooter inView={inView} />
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Diff                                                               */
/* ------------------------------------------------------------------ */

const DIFF_LINES = [
  { kind: "meta", text: "@@ -12,7 +12,7 @@ export const db = {", num: "" },
  { kind: "ctx", text: "  host: process.env.DB_HOST,", num: "12" },
  { kind: "ctx", text: "  pool: {", num: "13" },
  { kind: "del", text: "    max: 16,", num: "14" },
  { kind: "add", text: "    max: 48,", num: "14" },
  { kind: "ctx", text: "    idleTimeoutMillis: 30_000,", num: "15" },
  { kind: "ctx", text: "  },", num: "16" },
] as const;

function DiffHunk() {
  return (
    <div className="border-b border-fd-border">
      <div className="flex items-center justify-between px-5 py-2.5">
        <span className="font-mono text-[11px] text-fd-muted-foreground">
          src/db/pool.ts
        </span>
        <span className="font-mono text-[11px] text-fd-muted-foreground">
          <span className="text-primary">+1</span>{" "}
          <span className="text-fd-muted-foreground/70 line-through decoration-fd-muted-foreground/50">
            -1
          </span>
        </span>
      </div>
      <div className="overflow-x-auto border-t border-fd-border bg-fd-background/60">
        <pre className="min-w-max font-mono text-[12px] leading-relaxed">
          {DIFF_LINES.map((line, i) => (
            <DiffRow key={`${line.num}-${i}`} line={line} />
          ))}
        </pre>
      </div>
    </div>
  );
}

function DiffRow({ line }: { line: (typeof DIFF_LINES)[number] }) {
  const isAdd = line.kind === "add";
  const isDel = line.kind === "del";
  const isMeta = line.kind === "meta";
  const sign = isAdd ? "+" : isDel ? "-" : " ";

  return (
    <div
      className={cn(
        "flex",
        isAdd && "bg-primary/10",
        isDel && "bg-fd-muted/40",
        isMeta && "bg-fd-card/40",
      )}
    >
      <span className="w-10 shrink-0 select-none border-r border-fd-border/60 px-2 py-0.5 text-right text-fd-muted-foreground/40">
        {line.num}
      </span>
      <span
        className={cn(
          "w-5 shrink-0 select-none py-0.5 text-center",
          isAdd && "text-primary",
          isDel && "text-fd-muted-foreground/60",
          !isAdd && !isDel && "text-fd-muted-foreground/40",
        )}
      >
        {sign}
      </span>
      <span
        className={cn(
          "whitespace-pre py-0.5 pr-5",
          isAdd && "text-fd-foreground",
          isDel &&
            "text-fd-muted-foreground/70 line-through decoration-fd-muted-foreground/40",
          isMeta && "text-fd-muted-foreground/60",
          !isAdd && !isDel && !isMeta && "text-fd-muted-foreground",
        )}
      >
        {line.text}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline review comment — the agent's grounded evidence             */
/* ------------------------------------------------------------------ */

function ReviewComment({ inView }: { inView: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.6, delay: 0.65, ease: EASE }}
      className="border-b border-fd-border px-5 py-5"
    >
      <div className="rounded-lg border border-fd-border bg-fd-background/50">
        {/* Comment header */}
        <div className="flex items-center gap-2 border-b border-fd-border px-4 py-2.5">
          <span className="flex size-5 items-center justify-center rounded-full border border-primary/40 bg-fd-background text-primary">
            <Bot className="size-3" />
          </span>
          <span className="text-xs font-medium text-fd-foreground">
            everr-agent
          </span>
          <span className="text-xs text-fd-muted-foreground">
            left evidence on this change
          </span>
        </div>

        {/* Comment body */}
        <div className="space-y-3 px-4 py-4">
          <p className="text-sm leading-relaxed text-fd-muted-foreground">
            5xx on checkout spiked after{" "}
            <span className="font-mono text-fd-foreground">v812</span>. Pool was
            saturating under load. I queried Everr to confirm before touching
            config:
          </p>

          {/* Query → result */}
          <div className="overflow-x-auto rounded-md border border-fd-border bg-fd-background">
            <pre className="min-w-max px-4 py-3 font-mono text-[11.5px] leading-relaxed">
              <span className="text-fd-muted-foreground/60">{"// query"}</span>
              {"\n"}
              <span className="text-primary">everr.query</span>
              <span className="text-fd-muted-foreground">{"({ "}</span>
              <span className="text-fd-foreground">service</span>
              <span className="text-fd-muted-foreground">: </span>
              <span className="text-fd-muted-foreground">"checkout"</span>
              <span className="text-fd-muted-foreground">, </span>
              <span className="text-fd-foreground">since</span>
              <span className="text-fd-muted-foreground">: </span>
              <span className="text-fd-muted-foreground">"15m"</span>
              <span className="text-fd-muted-foreground">, </span>
              <span className="text-fd-foreground">where</span>
              <span className="text-fd-muted-foreground">: </span>
              <span className="text-fd-muted-foreground">"status&gt;=500"</span>
              <span className="text-fd-muted-foreground">{" })"}</span>
              {"\n\n"}
              <span className="text-fd-muted-foreground/60">{"// result"}</span>
              {"\n"}
              <span className="text-fd-muted-foreground">{"{ "}</span>
              <span className="text-fd-foreground">errors</span>
              <span className="text-fd-muted-foreground">: </span>
              <span className="text-primary">37</span>
              <span className="text-fd-muted-foreground">, </span>
              <span className="text-fd-foreground">p99_ms</span>
              <span className="text-fd-muted-foreground">: </span>
              <span className="text-primary">1840</span>
              <span className="text-fd-muted-foreground">,</span>
              {"\n"}
              <span className="text-fd-muted-foreground">{"  "}</span>
              <span className="text-fd-foreground">deploy</span>
              <span className="text-fd-muted-foreground">: </span>
              <span className="text-fd-muted-foreground">"v812"</span>
              <span className="text-fd-muted-foreground">, </span>
              <span className="text-fd-foreground">suspect</span>
              <span className="text-fd-muted-foreground">: </span>
              <span className="text-fd-muted-foreground">
                "db pool exhausted"
              </span>
              {"\n"}
              <span className="text-fd-muted-foreground">{"}"}</span>
            </pre>
          </div>

          {/* Sources / confidence */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11px] text-fd-muted-foreground/70">
            <span className="font-heading uppercase tracking-[0.12em]">
              Sources:
            </span>
            <span className="font-mono">traces · metrics · deploy log</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="font-heading uppercase tracking-[0.12em]">
                Confidence
              </span>
              <span className="text-primary">high</span>
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  CI checks                                                          */
/* ------------------------------------------------------------------ */

const CHECKS = [
  { name: "build", detail: "Successful in 42s", flips: false },
  { name: "unit tests", detail: "318 passed", flips: false },
  {
    name: "Everr · grounded in telemetry",
    detail: "Query evidence verified against live data",
    flips: true,
  },
] as const;

function ChecksBlock({ inView }: { inView: boolean }) {
  return (
    <div className="border-b border-fd-border px-5 py-5">
      <div className="overflow-hidden rounded-lg border border-fd-border bg-fd-background/50">
        <div className="flex items-center gap-2.5 border-b border-fd-border px-4 py-3">
          <CircleCheck className="size-4 text-primary" />
          <span className="text-sm font-medium text-fd-foreground">
            All checks have passed
          </span>
          <span className="text-xs text-fd-muted-foreground">3 / 3</span>
        </div>
        <ul className="divide-y divide-fd-border/60">
          {CHECKS.map((check, i) => (
            <CheckRow
              key={check.name}
              check={check}
              index={i}
              inView={inView}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function CheckRow({
  check,
  index,
  inView,
}: {
  check: (typeof CHECKS)[number];
  index: number;
  inView: boolean;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        {check.flips ? (
          <>
            {/* pending spinner ring, fades out */}
            <motion.span
              initial={{ opacity: 1 }}
              animate={inView ? { opacity: 0 } : undefined}
              transition={{ duration: 0.4, delay: 1.0, ease: EASE }}
              className="absolute inset-0 rounded-full border-2 border-fd-border border-t-fd-muted-foreground/60"
            />
            {/* passing check, fades in */}
            <motion.span
              initial={{ opacity: 0, scale: 0.4 }}
              animate={inView ? { opacity: 1, scale: 1 } : undefined}
              transition={{ duration: 0.45, delay: 1.05, ease: EASE }}
              className="flex size-5 items-center justify-center rounded-full bg-primary text-fd-background"
            >
              <Check className="size-3.5" strokeWidth={3} />
            </motion.span>
          </>
        ) : (
          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-fd-background">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-sm",
              check.flips
                ? "font-medium text-fd-foreground"
                : "text-fd-foreground",
            )}
          >
            {check.name}
          </span>
          {check.flips ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-primary">
              <Bot className="size-2.5" />
              agent
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-fd-muted-foreground">
          {check.detail}
        </p>
      </div>

      <span className="hidden font-mono text-[11px] text-fd-muted-foreground/60 sm:block">
        {index === 2 ? "details" : `${(index + 1) * 9}s`}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Merge footer — human approves                                     */
/* ------------------------------------------------------------------ */

function MergeFooter({ inView }: { inView: boolean }) {
  return (
    <div className="flex flex-col gap-4 bg-fd-card/40 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
      <motion.div
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : undefined}
        transition={{ duration: 0.5, delay: 1.3, ease: EASE }}
        className="flex items-center gap-2.5"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-fd-background">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
        <div className="text-sm">
          <span className="text-fd-foreground">Reviewed and approved by </span>
          <span className="font-medium text-fd-foreground">a.rossi</span>
          <p className="text-xs text-fd-muted-foreground">
            A human signs off — the agent only proposes.
          </p>
        </div>
      </motion.div>

      <button
        type="button"
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-5 py-2.5",
          "font-heading text-sm font-bold uppercase tracking-[0.12em] text-fd-background",
          "transition-colors hover:bg-primary/90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-card",
        )}
      >
        <GitMerge className="size-4" />
        Merge pull request
      </button>
    </div>
  );
}
