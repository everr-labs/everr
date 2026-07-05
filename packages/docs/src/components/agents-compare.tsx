import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, Bot, Check, TriangleAlert, User } from "lucide-react";
import { motion, useInView } from "motion/react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { WindowChrome } from "./ui/window-chrome";

const REVEAL = {
  initial: { opacity: 0, y: 24 },
  transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] as const },
};

/** A single reasoning line in the agent's transcript. */
type ReasonLine = { text: string; muted?: boolean };

const GUESSING_REASONING: ReasonLine[] = [
  { text: "Reading checkout.ts …", muted: true },
  { text: "The order-items query has no index." },
  { text: "Under load, that's the bottleneck.", muted: true },
  { text: "Adding an index on order_id." },
];

export function AgentsCompare() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section
      ref={ref}
      className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background"
    >
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
            Hand your coding agent a bug and it reasons from the code alone: plausible, confident,
            and often wrong.
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
            Reading code tells half the story.{" "}
            <span className="text-fd-muted-foreground">
              Everr gives you the half you are missing.
            </span>
          </p>
          <a
            href="/docs/reference/skills"
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
      className="flex flex-col rounded-2xl border border-dashed border-fd-border bg-fd-card/40 p-6 sm:p-8 md:rounded-r-none md:border-r-0"
    >
      <ColumnHeader label="Without Everr" sub="reasoning from code only" tone="muted" />

      <TaskLine />

      {/* Agent reasoning */}
      <AgentMessage className="mt-5">
        <ul className="space-y-2.5">
          {GUESSING_REASONING.map((line, i) => (
            <ReasonRow key={line.text} line={line} index={i} inView={inView} tone="muted" />
          ))}
        </ul>
      </AgentMessage>

      <div className="flex-1" />

      {/* The proposed fix — struck through, aligned with the message text */}
      <div className="mt-5 flex items-start gap-2.5">
        <div className="w-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 rounded-lg border border-dashed border-fd-border/70 bg-fd-card/30 p-4">
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
      </div>
    </motion.div>
  );
}

/** RIGHT — the agent grounded by real telemetry. Calm, factual, evidence-led. */
function GroundedColumn({ inView }: { inView: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ ...REVEAL.transition, delay: 0.3 }}
      className="relative flex flex-col rounded-2xl border border-fd-border bg-fd-card p-6 shadow-lg shadow-black/20 sm:p-8 md:rounded-l-none"
    >
      <ColumnHeader label="With Everr" sub="grounded in what ran" tone="primary" />

      <TaskLine />

      {/* 1 — acknowledge, then read what actually ran in prod */}
      <AgentMessage className="mt-5">
        <p className="text-[13.5px] leading-relaxed text-fd-foreground">
          On it. Let me check what actually ran in prod first.
        </p>
        <div className="divide-y divide-fd-border/50 overflow-hidden rounded-lg border border-fd-border bg-fd-background/60">
          <QueryRow
            verb="everr cloud query"
            sql="SELECT ResourceAttributes['service.version'] AS version, count() FROM traces WHERE ServiceName = 'checkout' AND StatusCode = 'Error' GROUP BY version"
            result={
              <>
                37 errors · <span className="font-medium text-fd-foreground">all on a1f3c9d</span>
              </>
            }
          />
          <QueryRow
            verb="everr cloud query"
            sql="SELECT Body, count() FROM logs WHERE ServiceName = 'checkout' AND SeverityText = 'ERROR' GROUP BY Body"
            result={
              <>
                37×{" "}
                <span className="font-medium text-fd-foreground">
                  “DB pool exhausted: 10/10 in use”
                </span>
              </>
            }
          />
        </div>
      </AgentMessage>

      {/* 2 — synthesis, then the fix as a diff (kept intact) */}
      <AgentMessage className="mt-5">
        <p className="text-[13.5px] leading-relaxed text-fd-foreground">
          All ten connections are in use, so the pool is my bottleneck. Commit <Code>a1f3c9d</Code>{" "}
          scaled checkout out to more workers but left the pool at 10, so requests queue for a
          connection, hit the acquire timeout, and 500. I&apos;ll raise the cap to match the
          workers.
        </p>
        <div className="overflow-hidden rounded-lg border border-fd-border bg-fd-background shadow-lg shadow-black/20">
          <WindowChrome
            title="db.ts"
            dots={false}
            className="bg-fd-card/60"
            trailing={
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
                <span className="text-green-400">+1</span>
                <span className="text-red-400/80">-1</span>
              </span>
            }
          />
          {/* diff body with a line-number gutter */}
          <div className="font-mono text-[13px] leading-relaxed">
            {/* removed line */}
            <div className="flex items-stretch bg-red-500/10">
              <span
                aria-hidden
                className="w-9 shrink-0 select-none border-r border-fd-border/60 px-2 py-1 text-right text-fd-muted-foreground/40"
              >
                12
              </span>
              <span aria-hidden className="select-none px-2 py-1 text-red-400/70">
                -
              </span>
              <code className="py-1 pr-3 text-fd-muted-foreground">
                {"pool: { max: "}
                <span className="rounded-sm bg-red-500/25 px-1 text-red-300">10</span>
                {" }"}
              </code>
            </div>
            {/* added line */}
            <div className="flex items-stretch bg-green-500/10">
              <span
                aria-hidden
                className="w-9 shrink-0 select-none border-r border-fd-border/60 px-2 py-1 text-right text-fd-muted-foreground/40"
              >
                12
              </span>
              <span aria-hidden className="select-none px-2 py-1 text-green-400">
                +
              </span>
              <code className="py-1 pr-3 text-fd-foreground">
                {"pool: { max: "}
                <span className="rounded-sm bg-green-500/25 px-1 font-semibold text-green-300">
                  50
                </span>
                {" }"}
                <span className="text-fd-muted-foreground/50">
                  {"  // saturated since a1f3c9d"}
                </span>
              </code>
            </div>
          </div>
        </div>
      </AgentMessage>

      {/* 3 — reproduce locally, then confirm */}
      <AgentMessage className="mt-5">
        <p className="text-[13.5px] leading-relaxed text-fd-foreground">
          Before I ship, I&apos;ll reproduce it locally, replaying the load against the patched pool
          and checking again with <Code>everr</Code>.
        </p>
        <div className="overflow-hidden rounded-lg border border-fd-border bg-fd-background/60">
          <QueryRow
            verb="everr local query"
            sql="SELECT count() FROM traces WHERE ServiceName = 'checkout' AND StatusCode = 'Error'"
            result={<span className="font-medium text-fd-foreground">0 errors</span>}
          />
        </div>
        <div className="flex items-center gap-2 text-fd-muted-foreground">
          <Check className="size-3.5 shrink-0 text-primary" />
          <span className="font-mono text-[11px] uppercase tracking-[0.12em]">fix confirmed</span>
        </div>
      </AgentMessage>
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
  );
}

/** One query in the agent's investigation: the command run, then the fact it returned. */
function QueryRow({ verb, sql, result }: { verb: string; sql: string; result: ReactNode }) {
  return (
    <div className="px-3.5 py-3">
      <code className="block whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed">
        <span className="select-none text-fd-muted-foreground/35">$ </span>
        <span className="text-fd-foreground/70">{verb} </span>
        <span className="text-fd-muted-foreground/70">{`"${sql}"`}</span>
      </code>
      <div className="mt-1.5 flex items-start gap-2 font-mono text-[12.5px] leading-relaxed">
        <span aria-hidden className="select-none text-fd-muted-foreground/35">
          →
        </span>
        <p className="min-w-0 flex-1 text-fd-foreground/90">{result}</p>
      </div>
    </div>
  );
}

/** The shared task — the human's opening message, identical on both sides. */
function TaskLine() {
  return (
    <div className="mt-6 flex items-start gap-2.5">
      <span
        aria-hidden
        className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-fd-border bg-fd-muted text-fd-muted-foreground"
      >
        <User className="size-3" />
      </span>
      <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-fd-foreground">
        checkout is throwing 500s, investigate and fix it.
      </p>
    </div>
  );
}

/** Small, subtle robot avatar that marks a turn as coming from the agent. */
function AgentAvatar() {
  return (
    <span
      aria-hidden
      className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-fd-border bg-fd-background text-fd-muted-foreground"
    >
      <Bot className="size-3" />
    </span>
  );
}

/** A spoken message from the agent: avatar in the gutter, prose alongside. */
function AgentMessage({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <AgentAvatar />
      <div className="min-w-0 flex-1 space-y-3">{children}</div>
    </div>
  );
}

/** Inline monospace chip for an identifier such as a commit sha or the CLI name. */
function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-[0.85em] text-fd-foreground">
      {children}
    </code>
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
        vs
      </span>
    </motion.div>
  );
}
