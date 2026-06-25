import { cn } from "@everr/ui/lib/utils";
import {
  Check,
  type LucideIcon,
  Play,
  Rocket,
  RotateCcw,
  Search,
  TrendingDown,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { motion, useInView, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/* ------------------------------------------------------------------ */
/*  Replay data — a short incident, told as a timestamped sequence     */
/* ------------------------------------------------------------------ */

const EASE = [0.22, 1, 0.36, 1] as const;

type Tone = "neutral" | "alert" | "agent" | "resolved";

type QueryChip = {
  /** The call the agent makes against Everr. */
  call: string;
  /** The structured response Everr hands back. */
  reply: string;
};

type Beat = {
  /** mm:ss stamp on the timeline. */
  time: string;
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  tone: Tone;
  /** Query steps carry a mono request -> response chip. */
  query?: QueryChip;
};

const BEATS: Beat[] = [
  {
    time: "00:00",
    icon: Rocket,
    title: "Deploy ships",
    tone: "neutral",
    body: (
      <>
        Release <span className="font-mono text-fd-foreground">v812</span> rolls
        out to <span className="font-mono text-fd-foreground">checkout</span>.
        Everything looks green.
      </>
    ),
  },
  {
    time: "00:42",
    icon: TriangleAlert,
    title: "Errors spike",
    tone: "alert",
    body: (
      <>
        5xx on <span className="font-mono text-fd-foreground">checkout</span>{" "}
        climbs off the floor. The agent picks up the alert before anyone
        refreshes a dashboard.
      </>
    ),
  },
  {
    time: "01:05",
    icon: Search,
    title: "Asks Everr what happened",
    tone: "agent",
    body: (
      <>
        Instead of guessing from the diff, the agent queries the same data a
        human would — and gets numbers back.
      </>
    ),
    query: {
      call: 'everr.query({ service:"checkout", since:"15m", where:"status>=500" })',
      reply: '{ errors: 37, p99_ms: 1840, deploy: "v812" }',
    },
  },
  {
    time: "01:18",
    icon: Wrench,
    title: "Finds the cause, applies a fix",
    tone: "agent",
    body: (
      <>
        It walks the slowest trace to the exhausted pool, then opens a small,
        reviewable change — not an autopilot rewrite.
      </>
    ),
    query: {
      call: 'everr.query({ trace:"a3f9…", show:"slowest_span" })',
      reply: '{ span:"db.pool.acquire", note:"pool exhausted" }',
    },
  },
  {
    time: "01:55",
    icon: TrendingDown,
    title: "Verifies — errors → 0",
    tone: "resolved",
    body: (
      <>
        It re-runs the same query against live traffic. Errors fall to{" "}
        <span className="font-mono text-fd-foreground">0</span>, p99 back to{" "}
        <span className="font-mono text-fd-foreground">~240ms</span>. Resolved.
      </>
    ),
    query: {
      call: 'everr.query({ service:"checkout", since:"5m", where:"status>=500" })',
      reply: '{ errors: 0, p99_ms: 240, status: "resolved" }',
    },
  },
];

/** Per-step advance cadence (ms) when auto-playing. */
const STEP_MS = 900;

/* ------------------------------------------------------------------ */
/*  Section                                                            */
/* ------------------------------------------------------------------ */

export function AgentsTimeline() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const reduceMotion = useReducedMotion();

  // `active` is the highest revealed step index. -1 = nothing yet.
  // With reduced motion (or before mount) everything is shown immediately so
  // content never depends on a class transition that won't fire headless.
  const [active, setActive] = useState(reduceMotion ? BEATS.length - 1 : -1);
  const [playing, setPlaying] = useState(false);

  const run = useCallback(() => {
    setActive(-1);
    setPlaying(true);
  }, []);

  // Kick the sequence the first time the section scrolls into view.
  useEffect(() => {
    if (reduceMotion) {
      setActive(BEATS.length - 1);
      return;
    }
    if (inView && active === -1 && !playing) run();
  }, [inView, active, playing, reduceMotion, run]);

  // Auto-advance the revealed step while playing.
  useEffect(() => {
    if (!playing || reduceMotion) return;
    if (active >= BEATS.length - 1) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setActive((i) => i + 1), STEP_MS);
    return () => window.clearTimeout(id);
  }, [playing, active, reduceMotion]);

  const allRevealed = active >= BEATS.length - 1;
  // Progress fraction for the filling line (0..1).
  const progress = reduceMotion ? 1 : Math.max(0, active) / (BEATS.length - 1);

  return (
    <section
      ref={ref}
      className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background"
    >
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · timeline
      </span>

      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        {/* Header */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Built for agents
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Watch an agent fix it — grounded by Everr at every step.
          </h2>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Your agents query the same data you do, find the real cause, ship a
            small fix, and prove it worked. No guessing from the diff — ground
            truth, in real time.
          </p>
        </motion.div>

        {/* Replay control */}
        <div className="mt-10 flex items-center gap-4">
          <button
            type="button"
            onClick={run}
            aria-label={
              allRevealed ? "Replay incident" : "Play incident replay"
            }
            className={cn(
              "group inline-flex items-center gap-2.5 rounded-full border border-fd-border bg-fd-card/60 py-2 pl-3 pr-4",
              "font-heading text-xs font-bold uppercase tracking-[0.18em] text-fd-foreground",
              "transition-colors hover:border-primary/60 hover:bg-fd-card",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
            )}
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-primary text-fd-background">
              {allRevealed && !playing ? (
                <RotateCcw className="size-3.5" strokeWidth={2.5} />
              ) : (
                <Play className="size-3.5 fill-current" strokeWidth={2.5} />
              )}
            </span>
            {allRevealed && !playing ? "Replay" : "Play replay"}
          </button>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-fd-muted-foreground/50">
            Incident · checkout · v812
          </span>
        </div>

        {/* ---------------- Horizontal timeline (md+) ---------------- */}
        <div className="mt-16 hidden md:block">
          <div className="grid grid-cols-5 gap-4">
            {/* The rail spans across the row of nodes. */}
            <div className="relative col-span-5 mb-10" aria-hidden>
              <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-fd-border" />
              <motion.div
                className="absolute left-0 top-1/2 h-px -translate-y-1/2 origin-left bg-primary"
                style={{ right: 0 }}
                animate={{ scaleX: progress }}
                transition={{ duration: 0.5, ease: EASE }}
              />
              <div className="relative grid grid-cols-5">
                {BEATS.map((beat, i) => (
                  <TimelineNode
                    key={beat.time}
                    beat={beat}
                    revealed={reduceMotion || i <= active}
                    activeNow={!reduceMotion && i === active && playing}
                    reduceMotion={!!reduceMotion}
                  />
                ))}
              </div>
            </div>

            {/* Cards under each node. */}
            {BEATS.map((beat, i) => (
              <BeatCard
                key={beat.time}
                beat={beat}
                revealed={reduceMotion || i <= active}
                reduceMotion={!!reduceMotion}
              />
            ))}
          </div>
        </div>

        {/* ---------------- Vertical timeline (mobile) ---------------- */}
        <div className="mt-14 md:hidden">
          <ol className="relative">
            {/* Vertical rail */}
            <div
              className="absolute bottom-3 left-[15px] top-3 w-px bg-fd-border"
              aria-hidden
            />
            <motion.div
              className="absolute left-[15px] top-3 w-px origin-top bg-primary"
              style={{ bottom: 12 }}
              animate={{ scaleY: progress }}
              transition={{ duration: 0.5, ease: EASE }}
              aria-hidden
            />
            {BEATS.map((beat, i) => (
              <MobileBeat
                key={beat.time}
                beat={beat}
                revealed={reduceMotion || i <= active}
                activeNow={!reduceMotion && i === active && playing}
                reduceMotion={!!reduceMotion}
              />
            ))}
          </ol>
        </div>

        {/* Footer: provenance + CTA */}
        <div className="mt-16 flex flex-col gap-8 border-t border-fd-border pt-8 md:flex-row md:items-center md:justify-between">
          <p className="max-w-xl text-sm leading-relaxed text-fd-muted-foreground/70">
            Every step shows its work — the exact query, the data it read, and
            how sure it is. Sources cited, confidence noted. Assist, not
            autopilot.
          </p>
          <a
            href="/docs"
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-6 py-3",
              "font-heading text-sm font-bold uppercase tracking-[0.16em] text-fd-background",
              "transition-transform hover:-translate-y-0.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
            )}
          >
            Give your agent the data
          </a>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Horizontal node (the dot + icon + timestamp on the rail)          */
/* ------------------------------------------------------------------ */

function TimelineNode({
  beat,
  revealed,
  activeNow,
  reduceMotion,
}: {
  beat: Beat;
  revealed: boolean;
  activeNow: boolean;
  reduceMotion: boolean;
}) {
  const Icon = beat.icon;
  const lit = revealed;
  return (
    <div className="flex flex-col items-center">
      <span className="mb-3 font-mono text-[11px] tracking-wide text-fd-muted-foreground/60">
        {beat.time}
      </span>
      <motion.div
        className={cn(
          "relative flex size-11 items-center justify-center rounded-full border bg-fd-background",
          lit
            ? "border-primary text-primary"
            : "border-fd-border text-fd-muted-foreground/40",
        )}
        initial={reduceMotion ? false : { scale: 0.8 }}
        animate={{ scale: revealed ? 1 : 0.8 }}
        transition={{ duration: 0.4, ease: EASE }}
      >
        <Icon className="size-[18px]" strokeWidth={2} />
        {activeNow ? (
          <motion.span
            className="absolute inset-0 rounded-full border border-primary"
            initial={{ opacity: 0.6, scale: 1 }}
            animate={{ opacity: 0, scale: 1.6 }}
            transition={{
              duration: 1.1,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeOut",
            }}
          />
        ) : null}
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Horizontal card (under each node)                                  */
/* ------------------------------------------------------------------ */

function BeatCard({
  beat,
  revealed,
  reduceMotion,
}: {
  beat: Beat;
  revealed: boolean;
  reduceMotion: boolean;
}) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: revealed ? 1 : 0.35, y: revealed ? 0 : 16 }}
      transition={{ duration: 0.5, ease: EASE }}
      className={cn(
        "flex h-full flex-col rounded-xl border p-4",
        beat.tone === "resolved"
          ? "border-primary/40 bg-fd-card/60"
          : "border-fd-border bg-fd-card/30",
      )}
    >
      <ToneLabel tone={beat.tone} />
      <h3 className="mt-2 font-heading text-sm font-bold leading-snug text-fd-foreground">
        {beat.title}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-fd-muted-foreground">
        {beat.body}
      </p>
      {beat.query ? <QueryBlock query={beat.query} /> : null}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile row                                                         */
/* ------------------------------------------------------------------ */

function MobileBeat({
  beat,
  revealed,
  activeNow,
  reduceMotion,
}: {
  beat: Beat;
  revealed: boolean;
  activeNow: boolean;
  reduceMotion: boolean;
}) {
  const Icon = beat.icon;
  return (
    <li className="relative flex gap-5 pb-8 last:pb-0">
      {/* Node */}
      <div className="relative z-10 flex flex-col items-center">
        <motion.div
          className={cn(
            "flex size-8 items-center justify-center rounded-full border bg-fd-background",
            revealed
              ? "border-primary text-primary"
              : "border-fd-border text-fd-muted-foreground/40",
          )}
          initial={reduceMotion ? false : { scale: 0.8 }}
          animate={{ scale: revealed ? 1 : 0.8 }}
          transition={{ duration: 0.4, ease: EASE }}
        >
          <Icon className="size-4" strokeWidth={2} />
          {activeNow ? (
            <motion.span
              className="absolute inset-0 rounded-full border border-primary"
              initial={{ opacity: 0.6, scale: 1 }}
              animate={{ opacity: 0, scale: 1.7 }}
              transition={{
                duration: 1.1,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeOut",
              }}
            />
          ) : null}
        </motion.div>
      </div>

      {/* Content */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, x: 12 }}
        animate={{ opacity: revealed ? 1 : 0.35, x: revealed ? 0 : 12 }}
        transition={{ duration: 0.5, ease: EASE }}
        className={cn(
          "min-w-0 flex-1 rounded-xl border p-4",
          beat.tone === "resolved"
            ? "border-primary/40 bg-fd-card/60"
            : "border-fd-border bg-fd-card/30",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <ToneLabel tone={beat.tone} />
          <span className="font-mono text-[11px] tracking-wide text-fd-muted-foreground/60">
            {beat.time}
          </span>
        </div>
        <h3 className="mt-2 font-heading text-sm font-bold leading-snug text-fd-foreground">
          {beat.title}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-fd-muted-foreground">
          {beat.body}
        </p>
        {beat.query ? <QueryBlock query={beat.query} /> : null}
      </motion.div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared bits                                                        */
/* ------------------------------------------------------------------ */

const TONE_TEXT: Record<Tone, string> = {
  neutral: "Deploy",
  alert: "Signal",
  agent: "Agent",
  resolved: "Resolved",
};

function ToneLabel({ tone }: { tone: Tone }) {
  const accent = tone === "alert" || tone === "agent" || tone === "resolved";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em]",
        accent ? "text-primary" : "text-fd-muted-foreground/60",
      )}
    >
      {tone === "resolved" ? (
        <Check className="size-3" strokeWidth={3} />
      ) : (
        <span
          className={cn(
            "size-1.5 rounded-full",
            accent ? "bg-primary" : "bg-fd-muted-foreground/40",
          )}
        />
      )}
      {TONE_TEXT[tone]}
    </span>
  );
}

/** Mono request -> response chip, the grounding moment of each agent step. */
function QueryBlock({ query }: { query: QueryChip }) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-fd-border bg-fd-background/80">
      <div className="border-b border-fd-border/70 px-3 py-2">
        <p className="break-words font-mono text-[11px] leading-relaxed text-fd-foreground/85">
          <span className="text-primary">→</span> {query.call}
        </p>
      </div>
      <div className="px-3 py-2">
        <p className="break-words font-mono text-[11px] leading-relaxed text-fd-muted-foreground">
          <span className="text-fd-muted-foreground/50">←</span> {query.reply}
        </p>
      </div>
    </div>
  );
}
