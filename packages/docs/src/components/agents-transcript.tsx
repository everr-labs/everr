import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, Bot, Terminal } from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

/* ------------------------------------------------------------------ */
/*  Transcript data                                                    */
/* ------------------------------------------------------------------ */

type JsonToken =
  | { t: "punc"; v: string }
  | { t: "key"; v: string }
  | { t: "str"; v: string }
  | { t: "num"; v: string }
  | { t: "bool"; v: string };

type Exchange = {
  /** The agent's outbound request. */
  request: JsonToken[];
  /** Everr's structured response. */
  response: JsonToken[];
  /** Faint provenance line — transparent reasoning, not autopilot. */
  meta: string;
};

const EASE = [0.22, 1, 0.36, 1] as const;

// Tiny tokenizer-by-hand so the JSON reads like a real tool-call trace without
// pulling in a syntax-highlighting dependency. Order is the render order.
const j = {
  p: (v: string): JsonToken => ({ t: "punc", v }),
  k: (v: string): JsonToken => ({ t: "key", v }),
  s: (v: string): JsonToken => ({ t: "str", v }),
  n: (v: string): JsonToken => ({ t: "num", v }),
  b: (v: string): JsonToken => ({ t: "bool", v }),
};

const EXCHANGES: Exchange[] = [
  {
    request: [
      j.p("everr.query({ "),
      j.k("service"),
      j.p(": "),
      j.s('"checkout"'),
      j.p(", "),
      j.k("since"),
      j.p(": "),
      j.s('"15m"'),
      j.p(", "),
      j.k("where"),
      j.p(": "),
      j.s('"status >= 500"'),
      j.p(" })"),
    ],
    response: [
      j.p("{ "),
      j.k("errors"),
      j.p(": "),
      j.n("37"),
      j.p(", "),
      j.k("p99_ms"),
      j.p(": "),
      j.n("1840"),
      j.p(", "),
      j.k("deploy"),
      j.p(": "),
      j.s('"v812"'),
      j.p(" }"),
    ],
    meta: "source: 2.1M spans · window: 15m · confidence: high",
  },
  {
    request: [
      j.p("everr.query({ "),
      j.k("compare"),
      j.p(": "),
      j.s('"p99"'),
      j.p(", "),
      j.k("deploy"),
      j.p(": ["),
      j.s('"v811"'),
      j.p(", "),
      j.s('"v812"'),
      j.p("] })"),
    ],
    response: [
      j.p("{ "),
      j.k("v811"),
      j.p(": "),
      j.n("240"),
      j.p(", "),
      j.k("v812"),
      j.p(": "),
      j.n("1840"),
      j.p(", "),
      j.k("regressed"),
      j.p(": "),
      j.b("true"),
      j.p(" }"),
    ],
    meta: "source: 2 deploys · baseline: v811 · confidence: high",
  },
  {
    request: [
      j.p("everr.query({ "),
      j.k("trace"),
      j.p(": "),
      j.s('"a3f9…"'),
      j.p(", "),
      j.k("show"),
      j.p(": "),
      j.s('"slowest_span"'),
      j.p(" })"),
    ],
    response: [
      j.p("{ "),
      j.k("span"),
      j.p(": "),
      j.s('"db.pool.acquire"'),
      j.p(", "),
      j.k("ms"),
      j.p(": "),
      j.n("1610"),
      j.p(", "),
      j.k("note"),
      j.p(": "),
      j.s('"pool exhausted"'),
      j.p(" }"),
    ],
    meta: "source: 1 trace · 24 spans · confidence: high",
  },
];

/* ------------------------------------------------------------------ */
/*  Token renderer                                                     */
/* ------------------------------------------------------------------ */

const TOKEN_CLASS: Record<JsonToken["t"], string> = {
  punc: "text-fd-muted-foreground/50",
  key: "text-fd-foreground/85",
  str: "text-fd-muted-foreground",
  num: "text-fd-foreground font-medium",
  bool: "text-fd-foreground font-medium",
};

function Json({ tokens }: { tokens: JsonToken[] }) {
  return (
    <>
      {tokens.map((tok, i) => (
        <span key={i} className={TOKEN_CLASS[tok.t]}>
          {tok.v}
        </span>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Log lines                                                          */
/* ------------------------------------------------------------------ */

/** Shared sequential reveal — content exists by default, animates in on view. */
function logLine(inView: boolean, order: number) {
  return {
    initial: { opacity: 0, y: 6 },
    animate: inView ? { opacity: 1, y: 0 } : undefined,
    transition: { duration: 0.5, delay: 0.25 + order * 0.12, ease: EASE },
  };
}

function RequestLine({ exchange }: { exchange: Exchange }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2 sm:px-6">
      <span className="select-none whitespace-nowrap pt-px text-fd-muted-foreground/70">
        agent <span className="text-fd-muted-foreground/40">{"→"}</span>
      </span>
      <code className="min-w-0 break-words text-fd-foreground/90">
        <Json tokens={exchange.request} />
      </code>
    </div>
  );
}

function ResponseLine({ exchange }: { exchange: Exchange }) {
  return (
    <div className="px-4 pb-3 sm:px-6">
      <div className="flex items-start gap-3 py-2">
        <span className="select-none whitespace-nowrap pt-px text-primary">
          everr <span className="text-primary/50">{"←"}</span>
        </span>
        <code className="min-w-0 break-words">
          <Json tokens={exchange.response} />
        </code>
      </div>
      <p className="pl-[4.25rem] text-[11px] leading-tight text-fd-muted-foreground/40">
        {exchange.meta}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section                                                            */
/* ------------------------------------------------------------------ */

export function AgentsTranscript() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background">
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · transcript
      </span>

      <div
        ref={ref}
        className="mx-auto grid max-w-7xl items-start gap-12 px-6 py-24 md:py-36 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16"
      >
        {/* ---- Left: heading + payoff + CTA ---- */}
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
            Your agent queries the data.
            <br />
            <span className="text-fd-muted-foreground/55">
              It stops guessing.
            </span>
          </h2>
          <p className="mt-6 max-w-md text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Coding agents ask Everr what your software actually did — real error
            rates, real latency, the slow span — and act on the answer. Every
            response shows its sources, so you can trust it.
          </p>
          <p className="mt-4 max-w-md text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            The same queries serve you, your CI, and your agents. One contract,
            one set of answers.
          </p>

          <a
            href="/docs"
            className={cn(
              "group mt-8 inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card/40 px-5 py-2.5",
              "font-heading text-sm font-medium text-fd-foreground transition-colors",
              "hover:border-primary/60 hover:bg-fd-card",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
            )}
          >
            Read the query API
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </motion.div>

        {/* ---- Right: the query-log transcript ---- */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, delay: 0.1, ease: EASE }}
          className="overflow-hidden rounded-xl border border-fd-border bg-fd-card/40 shadow-2xl shadow-black/30"
        >
          {/* Window chrome */}
          <div className="flex items-center gap-3 border-b border-fd-border bg-fd-card/60 px-4 py-3 sm:px-6">
            <Terminal className="size-4 text-fd-muted-foreground/60" />
            <span className="font-mono text-xs text-fd-muted-foreground/70">
              everr · tool-call trace
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-fd-muted-foreground/50">
              <span className="size-1.5 rounded-full bg-primary" />
              live
            </span>
          </div>

          {/* Log body */}
          <div className="overflow-x-auto">
            <div className="min-w-0 font-mono text-[13px] leading-relaxed sm:text-sm">
              {EXCHANGES.map((exchange, i) => (
                <motion.div
                  key={i}
                  {...logLine(inView, i)}
                  className={cn(
                    "relative",
                    i > 0 && "border-t border-fd-border/60",
                  )}
                >
                  <RequestLine exchange={exchange} />
                  <ResponseLine exchange={exchange} />
                </motion.div>
              ))}

              {/* Trailing prompt — keeps the "live" feel without a chat input */}
              <motion.div
                {...logLine(inView, EXCHANGES.length)}
                className="flex items-center gap-3 border-t border-fd-border/60 px-4 py-3 text-fd-muted-foreground/50 sm:px-6"
              >
                <Bot className="size-3.5 shrink-0" />
                <span className="select-none">agent</span>
                <span className="inline-block h-4 w-px animate-pulse bg-primary/70" />
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
