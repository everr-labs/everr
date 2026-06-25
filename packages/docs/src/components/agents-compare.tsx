import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, Bot, Check, TriangleAlert, X } from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

const REVEAL = {
  initial: { opacity: 0, y: 24 },
  transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] as const },
};

/** A single reasoning line in the agent's transcript. */
type ReasonLine = { text: string; muted?: boolean };

const GUESSING_REASONING: ReasonLine[] = [
  { text: "Reading checkout.ts …", muted: true },
  { text: "This loop hits the DB on every item." },
  { text: "Probably a slow query under load.", muted: true },
  { text: "I'll add an index and hope it sticks." },
];

const GROUNDED_REASONING: ReasonLine[] = [
  { text: "Asking Everr what actually ran …", muted: true },
  { text: "37 errors in the last 15m, all 5xx." },
  { text: "Spike starts exactly at deploy v812." },
  { text: "DB pool exhausted — not the query." },
];

export function AgentsCompare() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section
      ref={ref}
      className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background"
    >
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · compare
      </span>

      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        {/* Header */}
        <motion.div
          initial={REVEAL.initial}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={REVEAL.transition}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Built for agents
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Same task. One side is guessing.
          </h2>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Hand your coding agent a bug and it reasons from the code alone —
            plausible, confident, and often wrong. Give it a query into what
            your software actually did, and the guess becomes a fact.
          </p>
        </motion.div>

        {/* Compare grid */}
        <div className="relative mt-14 md:mt-20">
          <div className="grid items-stretch gap-6 md:grid-cols-2 md:gap-0">
            <GuessingColumn inView={inView} />
            <GroundedColumn inView={inView} />
            <VersusMarker inView={inView} />
          </div>
        </div>

        {/* Payoff + CTA */}
        <motion.div
          initial={REVEAL.initial}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ ...REVEAL.transition, delay: 0.5 }}
          className="mt-16 flex flex-col gap-8 border-t-2 border-fd-border pt-10 md:mt-20 md:flex-row md:items-end md:justify-between"
        >
          <p className="max-w-xl text-balance font-heading text-xl leading-snug text-fd-foreground md:text-2xl">
            Reading the code tells half the story.{" "}
            <span className="text-fd-muted-foreground">
              Everr tells the half that actually ran.
            </span>
          </p>
          <a
            href="/docs/agents"
            className="group inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-primary px-6 py-3 font-heading text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
          >
            Wire it into your agent
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Columns                                                            */
/* ------------------------------------------------------------------ */

/** LEFT — the agent guessing. Dimmed, dashed, tentative. */
function GuessingColumn({ inView }: { inView: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 0.78, y: 0 } : undefined}
      transition={{ ...REVEAL.transition, delay: 0.15 }}
      className="flex flex-col rounded-2xl border border-dashed border-fd-border bg-fd-card/20 p-6 md:rounded-r-none md:border-r-0 md:p-8"
    >
      <ColumnHeader
        label="Without Everr"
        sub="reasoning from code only"
        tone="muted"
      />

      <TaskLine />

      {/* Agent transcript */}
      <div className="mt-6 flex-1">
        <SpeakerTag tone="muted" />
        <ul className="mt-3 space-y-2.5">
          {GUESSING_REASONING.map((line, i) => (
            <ReasonRow
              key={line.text}
              line={line}
              index={i}
              inView={inView}
              tone="muted"
            />
          ))}
        </ul>
      </div>

      {/* The fix — struck through, uncertain */}
      <div className="mt-6 rounded-lg border border-dashed border-fd-border/70 bg-fd-card/30 p-4">
        <p className="font-heading text-[10px] font-bold uppercase tracking-[0.2em] text-fd-muted-foreground/50">
          Proposed fix
        </p>
        <pre className="mt-2 overflow-x-auto font-mono text-[13px] leading-relaxed text-fd-muted-foreground line-through decoration-fd-muted-foreground/50">
          <code>{`+ CREATE INDEX idx_items_order\n+   ON order_items (order_id);`}</code>
        </pre>
        <div className="mt-3 flex items-center gap-2 text-fd-muted-foreground/80">
          <TriangleAlert className="size-3.5 shrink-0 text-amber-500/70" />
          <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
            no evidence · didn&apos;t fix the outage
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/** RIGHT — the agent grounded by a real query. Bright, sharp, lime-accented. */
function GroundedColumn({ inView }: { inView: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ ...REVEAL.transition, delay: 0.3 }}
      className="relative flex flex-col rounded-2xl border-2 border-primary/60 bg-fd-card p-6 ring-1 ring-inset ring-primary/10 md:rounded-l-none md:p-8"
    >
      <ColumnHeader
        label="With Everr"
        sub="grounded in what ran"
        tone="primary"
      />

      <TaskLine />

      {/* The query the agent runs */}
      <div className="mt-6 overflow-hidden rounded-lg border border-fd-border bg-fd-background">
        <div className="flex items-center gap-2 border-b border-fd-border px-3 py-2">
          <span className="size-1.5 rounded-full bg-primary" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fd-muted-foreground">
            everr.query
          </span>
        </div>
        <pre className="overflow-x-auto px-3 py-3 font-mono text-[12.5px] leading-relaxed text-fd-foreground sm:text-[13px]">
          <code>
            <span className="text-fd-muted-foreground">everr.</span>query({"{"}
            {"\n  "}service:{" "}
            <span className="text-primary">&quot;checkout&quot;</span>,{"\n  "}
            since: <span className="text-primary">&quot;15m&quot;</span>,
            {"\n  "}where:{" "}
            <span className="text-primary">&quot;status &gt;= 500&quot;</span>,
            {"\n"}
            {"}"})
          </code>
        </pre>
      </div>

      {/* JSON evidence back */}
      <div className="mt-3 overflow-hidden rounded-lg border border-fd-border bg-fd-background">
        <pre className="overflow-x-auto px-3 py-3 font-mono text-[12.5px] leading-relaxed sm:text-[13px]">
          <code className="text-fd-muted-foreground">
            {"{ "}errors: <span className="text-fd-foreground">37</span>,
            p99_ms: <span className="text-fd-foreground">1840</span>,{"\n  "}
            deploy: <span className="text-fd-foreground">&quot;v812&quot;</span>
            ,{"\n  "}suspect:{" "}
            <span className="text-primary">&quot;db pool exhausted&quot;</span>{" "}
            {"}"}
          </code>
        </pre>
      </div>

      {/* Grounded reasoning */}
      <div className="mt-6 flex-1">
        <SpeakerTag tone="primary" />
        <ul className="mt-3 space-y-2.5">
          {GROUNDED_REASONING.map((line, i) => (
            <ReasonRow
              key={line.text}
              line={line}
              index={i}
              inView={inView}
              tone="primary"
            />
          ))}
        </ul>
      </div>

      {/* The correct fix */}
      <div className="mt-6 rounded-lg border border-primary/40 bg-primary/5 p-4">
        <p className="font-heading text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
          Correct fix
        </p>
        <pre className="mt-2 overflow-x-auto font-mono text-[13px] leading-relaxed text-fd-foreground">
          <code>{`- pool: { max: 10 }\n+ pool: { max: 50 }  // saturated at v812`}</code>
        </pre>
        <div className="mt-3 flex items-center gap-2 text-fd-muted-foreground">
          <Check className="size-3.5 shrink-0 text-primary" />
          <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
            sources: 2.1M spans · confidence: high
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared pieces                                                      */
/* ------------------------------------------------------------------ */

function ColumnHeader({
  label,
  sub,
  tone,
}: {
  label: string;
  sub: string;
  tone: "muted" | "primary";
}) {
  const primary = tone === "primary";
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3
          className={cn(
            "font-heading text-lg font-bold tracking-tight",
            primary ? "text-fd-foreground" : "text-fd-muted-foreground",
          )}
        >
          {label}
        </h3>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-fd-muted-foreground/60">
          {sub}
        </p>
      </div>
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border",
          primary
            ? "border-primary/50 text-primary"
            : "border-dashed border-fd-border text-fd-muted-foreground/60",
        )}
      >
        <Bot className="size-4" />
      </span>
    </div>
  );
}

/** The shared task, identical on both sides — the constant being controlled for. */
function TaskLine() {
  return (
    <div className="mt-6 flex items-start gap-2.5 border-l-2 border-fd-border/70 pl-3">
      <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-fd-muted-foreground/50">
        task
      </span>
      <p className="font-mono text-[12.5px] leading-snug text-fd-muted-foreground">
        &quot;checkout is throwing 500s — find it and fix it.&quot;
      </p>
    </div>
  );
}

function SpeakerTag({ tone }: { tone: "muted" | "primary" }) {
  const primary = tone === "primary";
  return (
    <span
      className={cn(
        "font-heading text-[10px] font-bold uppercase tracking-[0.2em]",
        primary ? "text-primary" : "text-fd-muted-foreground/50",
      )}
    >
      Agent reasoning
    </span>
  );
}

function ReasonRow({
  line,
  index,
  inView,
  tone,
}: {
  line: ReasonLine;
  index: number;
  inView: boolean;
  tone: "muted" | "primary";
}) {
  const primary = tone === "primary";
  const isConclusion = !line.muted;
  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={inView ? { opacity: 1, x: 0 } : undefined}
      transition={{
        duration: 0.5,
        delay: (primary ? 0.45 : 0.3) + index * 0.08,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="flex items-start gap-2.5"
    >
      <span
        className={cn(
          "mt-1.5 size-1 shrink-0 rounded-full",
          primary
            ? isConclusion
              ? "bg-primary"
              : "bg-fd-muted-foreground/40"
            : "bg-fd-muted-foreground/30",
        )}
      />
      <span
        className={cn(
          "text-[13.5px] leading-snug",
          line.muted
            ? "text-fd-muted-foreground/60"
            : primary
              ? "font-medium text-fd-foreground"
              : "text-fd-muted-foreground",
        )}
      >
        {line.text}
      </span>
    </motion.li>
  );
}

/** Center "vs" badge sitting on the seam between the two columns. */
function VersusMarker({ inView }: { inView: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={inView ? { opacity: 1, scale: 1 } : undefined}
      transition={{ duration: 0.5, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 md:block"
    >
      <span className="flex size-12 items-center justify-center rounded-full border border-fd-border bg-fd-background font-heading text-[11px] font-bold uppercase tracking-[0.1em] text-fd-muted-foreground shadow-lg">
        <X className="size-3 text-fd-muted-foreground/40" />
        <span className="-ml-0.5">vs</span>
      </span>
    </motion.div>
  );
}
