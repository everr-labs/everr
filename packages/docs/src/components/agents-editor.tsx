import { cn } from "@everr/ui/lib/utils";
import {
  ArrowRight,
  Bot,
  Check,
  CornerDownRight,
  FileCode,
  Sparkles,
} from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/*  Editor source lines                                                */
/* ------------------------------------------------------------------ */

type Token = { text: string; cls?: string };
type Line = {
  no: number;
  tokens: Token[];
  /** marks the line as the agent's grounded edit */
  added?: boolean;
};

const KW = "text-fd-foreground";
const DIM = "text-fd-muted-foreground/70";
const STR = "text-fd-muted-foreground";

const CODE: Line[] = [
  {
    no: 22,
    tokens: [
      { text: "export async function ", cls: DIM },
      { text: "createCheckout", cls: KW },
      { text: "(cart) {", cls: DIM },
    ],
  },
  {
    no: 23,
    tokens: [
      { text: "  const ", cls: DIM },
      { text: "pool", cls: KW },
      { text: " = ", cls: DIM },
      { text: "getPool", cls: KW },
      { text: "({", cls: DIM },
    ],
  },
  {
    no: 24,
    added: true,
    tokens: [
      { text: "    max: ", cls: KW },
      { text: "48", cls: "text-primary" },
      { text: ", ", cls: DIM },
      { text: "// was 10 — db pool exhausted under load", cls: STR },
    ],
  },
  {
    no: 25,
    tokens: [
      { text: "    idleTimeoutMillis: ", cls: KW },
      { text: "30_000", cls: STR },
      { text: ",", cls: DIM },
    ],
  },
  {
    no: 26,
    tokens: [{ text: "  });", cls: DIM }],
  },
  {
    no: 27,
    tokens: [{ text: "", cls: DIM }],
  },
  {
    no: 28,
    tokens: [
      { text: "  return ", cls: DIM },
      { text: "pool", cls: KW },
      { text: ".", cls: DIM },
      { text: "transaction", cls: KW },
      { text: "(cart);", cls: DIM },
    ],
  },
  {
    no: 29,
    tokens: [{ text: "}", cls: DIM }],
  },
];

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function AgentsEditor() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background">
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · editor
      </span>

      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          {/* ----- Copy column ----- */}
          <motion.div
            ref={ref}
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.8, ease: EASE }}
            className="lg:sticky lg:top-28"
          >
            <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
              Built for agents
            </p>
            <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
              Your agent fixes it
              <br className="hidden sm:block" /> from real data, not a hunch.
            </h2>
            <p className="mt-6 max-w-md text-base leading-relaxed text-fd-muted-foreground md:text-lg">
              Right in the editor, the agent asks Everr what your code actually
              did — error rate, p99, the deploy that broke it — then writes the
              fix from the answer. You stay in the loop on every step.
            </p>

            <ul className="mt-8 space-y-3">
              {[
                "It queries the same data you and CI already use.",
                "Every call shows its source, so you can check the work.",
                "Suggests the edit — you decide whether it ships.",
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-3 text-sm text-fd-muted-foreground"
                >
                  <CornerDownRight
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <a
              href="/docs"
              className="group mt-10 inline-flex items-center gap-2 rounded-md border border-fd-border bg-fd-card px-5 py-3 font-heading text-sm font-bold text-fd-foreground transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
            >
              See how agents query Everr
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </a>
          </motion.div>

          {/* ----- Editor mock column ----- */}
          <EditorMock inView={inView} />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Editor mock                                                         */
/* ------------------------------------------------------------------ */

function EditorMock({ inView }: { inView: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.9, delay: 0.1, ease: EASE }}
      className="relative"
    >
      <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-2xl">
        {/* window chrome */}
        <div className="flex items-center gap-3 border-b border-fd-border bg-fd-card/60 px-4 py-2.5">
          <div className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-fd-muted-foreground/30" />
            <span className="size-2.5 rounded-full bg-fd-muted-foreground/30" />
            <span className="size-2.5 rounded-full bg-fd-muted-foreground/30" />
          </div>
          <div className="ml-2 flex items-center gap-2 rounded-t-md border-x border-t border-fd-border bg-fd-background px-3 py-1.5">
            <FileCode className="size-3.5 text-primary" aria-hidden />
            <span className="font-mono text-xs text-fd-foreground">
              checkout.ts
            </span>
          </div>
          <span className="ml-auto hidden font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/50 sm:inline">
            src/payments
          </span>
        </div>

        {/* code area */}
        <div className="overflow-x-auto bg-fd-background">
          <div className="min-w-[34rem] py-4 sm:min-w-0">
            {CODE.map((line) => (
              <CodeRow key={line.no} line={line} inView={inView} />
            ))}
          </div>
        </div>

        {/* agent tool-call panel */}
        <AgentPanel inView={inView} />
      </div>

      {/* annotation callouts */}
      <Annotation
        inView={inView}
        delay={1.9}
        className="-right-2 top-[7.5rem] hidden xl:flex"
      >
        Read the real p99 — 1,840 ms — not a guess.
      </Annotation>
      <Annotation
        inView={inView}
        delay={2.1}
        className="-left-3 bottom-24 hidden xl:flex"
      >
        Same query a human would run.
      </Annotation>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Code row                                                           */
/* ------------------------------------------------------------------ */

function CodeRow({ line, inView }: { line: Line; inView: boolean }) {
  return (
    <div
      className={cn(
        "relative flex items-center font-mono text-[13px] leading-6",
        line.added && "bg-primary/10",
      )}
    >
      {line.added ? (
        <motion.span
          initial={{ scaleY: 0 }}
          animate={inView ? { scaleY: 1 } : undefined}
          transition={{ duration: 0.5, delay: 2.4, ease: EASE }}
          className="absolute inset-y-0 left-0 w-[2px] origin-top bg-primary"
          aria-hidden
        />
      ) : null}

      {/* gutter — hidden on mobile */}
      <span
        className={cn(
          "hidden w-12 shrink-0 select-none pr-3 text-right text-[11px] sm:inline-block",
          line.added ? "text-primary" : "text-fd-muted-foreground/40",
        )}
        aria-hidden
      >
        {line.added ? "+" : line.no}
      </span>

      <code className="whitespace-pre pl-4 pr-6 sm:pl-0">
        {line.tokens.map((t, ti) => (
          <span key={`${line.no}-${ti}-${t.text}`} className={t.cls}>
            {t.text}
          </span>
        ))}
        {line.added ? (
          <motion.span
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : undefined}
            transition={{ duration: 0.4, delay: 2.6, ease: EASE }}
            className="ml-3 inline-flex items-center gap-1 rounded border border-primary/40 px-1.5 py-px align-middle font-heading text-[9px] font-bold uppercase tracking-[0.15em] text-primary"
          >
            <Sparkles className="size-2.5" aria-hidden />
            agent
          </motion.span>
        ) : null}
      </code>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent tool-call panel                                              */
/* ------------------------------------------------------------------ */

function AgentPanel({ inView }: { inView: boolean }) {
  return (
    <div className="border-t border-fd-border bg-fd-card/40">
      {/* header strip */}
      <div className="flex items-center gap-2 border-b border-fd-border/60 px-4 py-2">
        <Bot className="size-3.5 text-primary" aria-hidden />
        <span className="font-heading text-[11px] font-bold uppercase tracking-[0.2em] text-fd-foreground">
          Agent
        </span>
        <span className="font-mono text-[11px] text-fd-muted-foreground">
          investigating failed checkouts
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-primary" />
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-fd-muted-foreground/60">
            live
          </span>
        </span>
      </div>

      <div className="space-y-3 overflow-x-auto px-4 py-4">
        {/* request */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.5, delay: 0.9, ease: EASE }}
          className="font-mono text-[12px] leading-relaxed"
        >
          <span className="select-none text-primary">→ </span>
          <span className="text-fd-muted-foreground">everr.</span>
          <span className="text-fd-foreground">query</span>
          <span className="text-fd-muted-foreground">({"{ "}service:</span>
          <span className="text-fd-foreground">"checkout"</span>
          <span className="text-fd-muted-foreground">, since:</span>
          <span className="text-fd-foreground">"15m"</span>
          <span className="text-fd-muted-foreground">, where:</span>
          <span className="text-fd-foreground">"status&gt;=500"</span>
          <span className="text-fd-muted-foreground">{" }"})</span>
        </motion.div>

        {/* response */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.5, delay: 1.4, ease: EASE }}
          className="rounded-md border border-fd-border bg-fd-background px-3 py-2.5 font-mono text-[12px] leading-relaxed"
        >
          <span className="select-none text-fd-muted-foreground/60">
            ← everr returns
          </span>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <ResponseField label="errors" value="37" />
            <ResponseField label="p99_ms" value="1840" accent />
            <ResponseField label="deploy" value='"v812"' />
            <ResponseField label="suspect" value='"db pool exhausted"' accent />
          </div>
        </motion.div>

        {/* grounded conclusion */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.5, delay: 2.2, ease: EASE }}
          className="flex flex-wrap items-center gap-2"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-heading text-[11px] font-bold text-primary">
            <Check className="size-3" aria-hidden />
            Applied edit
          </span>
          <span className="text-[12px] text-fd-muted-foreground">
            Raised pool max to 48 on line 24, grounded by the live p99.
          </span>
        </motion.div>

        {/* source / confidence note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 0.7 } : undefined}
          transition={{ duration: 0.5, delay: 2.6, ease: EASE }}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-fd-muted-foreground/60"
        >
          source: traces · 14,902 spans · last 15m — confidence high
        </motion.p>
      </div>
    </div>
  );
}

function ResponseField({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-fd-muted-foreground/70">{label}:</span>{" "}
      <span className={accent ? "text-primary" : "text-fd-foreground"}>
        {value}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Annotation callout                                                 */
/* ------------------------------------------------------------------ */

function Annotation({
  children,
  className,
  delay,
  inView,
}: {
  children: React.ReactNode;
  className?: string;
  delay: number;
  inView: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={inView ? { opacity: 1, scale: 1 } : undefined}
      transition={{ duration: 0.6, delay, ease: EASE }}
      className={cn(
        "pointer-events-none absolute z-10 max-w-[12rem] items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-3 py-2 font-heading text-[11px] font-medium leading-snug text-fd-foreground shadow-xl",
        className,
      )}
    >
      <Sparkles className="size-3 shrink-0 text-primary" aria-hidden />
      <span>{children}</span>
    </motion.div>
  );
}
