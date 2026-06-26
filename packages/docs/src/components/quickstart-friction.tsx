import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, Check, Clock, Copy, Terminal, X } from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Placeholder content                                                */
/* ------------------------------------------------------------------ */

const OLD_WAY_STEPS = [
  "Pick a backend",
  "Stand up a collector",
  "Wire exporters per service",
  "Configure sampling",
  "Build dashboards from scratch",
  "Set up alert routing",
  "Stitch logs to traces by hand",
  "Reconcile a dozen YAML files",
  "Debug why no data shows up",
] as const;

const EVERR_STEPS = [
  "Installs the everr CLI",
  "Runs guided setup",
  "Local collector ready",
  "First trace in minutes",
] as const;

const COMMAND = "curl -fsSL https://everr.dev/install.sh | sh";

const EASE = [0.22, 1, 0.36, 1] as const;

const REVEAL = {
  initial: { opacity: 0, y: 24 },
  transition: { duration: 0.8, ease: EASE },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function QuickstartFriction() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(COMMAND);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Clipboard unavailable (insecure context / denied permission) — no-op.
    }
  };

  return (
    <section className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background">
      <div
        ref={ref}
        className="relative z-10 mx-auto max-w-7xl px-6 py-24 md:py-36"
      >
        {/* ---- Header ---- */}
        <motion.div
          initial={REVEAL.initial}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={REVEAL.transition}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Quick start
          </p>
          <h2 className="mt-5 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Days of setup, or one command.
          </h2>
          <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-fd-muted-foreground sm:text-lg">
            The usual path to observability is a week of yak-shaving. Everr is
            one line: install the CLI, run guided setup, and you&rsquo;re
            sending telemetry in minutes.
          </p>
        </motion.div>

        {/* ---- Friction collapse: two columns + center "vs" ---- */}
        <div className="relative mt-16 grid grid-cols-1 gap-6 md:mt-20 md:grid-cols-2 md:gap-0">
          {/* LEFT — the old way (dimmed, heavy, draining) */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.85, delay: 0.15, ease: EASE }}
            className="flex flex-col rounded-2xl border border-dashed border-fd-border bg-fd-card/40 p-6 sm:p-8 md:rounded-r-none md:border-r-0"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="font-heading text-xs font-bold uppercase tracking-[0.25em] text-fd-muted-foreground/70">
                The old way
              </h3>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/40">
                manual
              </span>
            </div>

            {/* The wall of yak-shaving */}
            <ol className="mt-6 flex-1 space-y-px">
              {OLD_WAY_STEPS.map((step, i) => (
                <motion.li
                  key={step}
                  initial={{ opacity: 0, x: -8 }}
                  animate={inView ? { opacity: 1, x: 0 } : undefined}
                  transition={{
                    duration: 0.5,
                    delay: 0.3 + i * 0.05,
                    ease: EASE,
                  }}
                  className="flex items-center gap-3 border-b border-dashed border-fd-border/40 py-2.5 last:border-b-0"
                >
                  <X
                    className="h-3.5 w-3.5 shrink-0 text-fd-muted-foreground/40"
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span className="font-mono text-[10px] tabular-nums text-fd-muted-foreground/30">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm leading-tight text-fd-muted-foreground/60 line-through decoration-fd-muted-foreground/25">
                    {step}
                  </span>
                </motion.li>
              ))}
            </ol>

            {/* Big, muted time tag */}
            <div className="mt-8 flex items-center gap-3 border-t border-dashed border-fd-border/50 pt-6">
              <Clock
                className="h-5 w-5 text-fd-muted-foreground/40"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="font-mono text-4xl font-bold leading-none tracking-tight text-fd-muted-foreground/50 sm:text-5xl">
                ~3 days
              </span>
              <span className="ml-auto font-heading text-[11px] font-bold uppercase tracking-[0.2em] text-fd-muted-foreground/40">
                to first trace
              </span>
            </div>
          </motion.div>

          {/* Center "vs" marker */}
          <div
            aria-hidden
            className="pointer-events-none z-10 flex items-center justify-center md:absolute md:inset-y-0 md:left-1/2 md:-translate-x-1/2"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-fd-border bg-fd-background font-heading text-xs font-bold uppercase tracking-[0.15em] text-fd-muted-foreground shadow-lg shadow-black/30">
              vs
            </span>
          </div>

          {/* RIGHT — with Everr (full contrast, lime, light, fast) */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.85, delay: 0.3, ease: EASE }}
            className="flex flex-col rounded-2xl border border-fd-border bg-fd-card p-6 shadow-2xl shadow-black/40 sm:p-8 md:rounded-l-none"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="font-heading text-xs font-bold uppercase tracking-[0.25em] text-fd-foreground">
                With Everr
              </h3>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
                one command
              </span>
            </div>

            {/* The single command */}
            <div className="mt-6 overflow-hidden rounded-xl border border-fd-border bg-fd-background">
              <div className="flex items-center gap-2 border-b border-fd-border px-4 py-2.5 text-fd-muted-foreground/70">
                <Terminal className="h-3.5 w-3.5" aria-hidden />
                <span className="font-mono text-[11px] tracking-tight">
                  terminal
                </span>
              </div>
              <div className="flex items-stretch gap-3 px-4 py-5">
                <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:thin]">
                  <code className="flex items-center gap-2 whitespace-nowrap font-mono text-sm sm:text-base md:text-lg">
                    <span className="select-none text-primary" aria-hidden>
                      $
                    </span>
                    <span className="text-fd-foreground">{COMMAND}</span>
                  </code>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label={copied ? "Copied" : "Copy command"}
                  className={cn(
                    "group inline-flex shrink-0 items-center gap-2 self-center rounded-lg border px-3 py-2 font-heading text-xs font-bold uppercase tracking-[0.15em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
                    copied
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-fd-border bg-fd-card text-fd-muted-foreground hover:border-primary/50 hover:text-fd-foreground",
                  )}
                >
                  {copied ? (
                    <Check className="h-4 w-4" aria-hidden />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden />
                  )}
                  <span className="hidden sm:inline">
                    {copied ? "Copied" : "Copy"}
                  </span>
                </button>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-fd-muted-foreground">
              One installer sets up the CLI and a local collector — nothing else
              to wire.{" "}
              <span className="text-fd-muted-foreground/60">
                macOS · Apple Silicon.
              </span>
            </p>

            {/* Short, crisp lime checklist */}
            <ul className="mt-6 flex-1 space-y-3">
              {EVERR_STEPS.map((step, i) => (
                <motion.li
                  key={step}
                  initial={{ opacity: 0, x: 8 }}
                  animate={inView ? { opacity: 1, x: 0 } : undefined}
                  transition={{
                    duration: 0.5,
                    delay: 0.5 + i * 0.08,
                    ease: EASE,
                  }}
                  className="flex items-center gap-3"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/50 bg-primary/10">
                    <Check
                      className="h-3 w-3 text-primary"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  </span>
                  <span className="text-sm leading-tight text-fd-foreground">
                    {step}
                  </span>
                </motion.li>
              ))}
            </ul>

            {/* Big, lime-accented time tag */}
            <div className="mt-8 flex items-center gap-3 border-t border-fd-border pt-6">
              <Clock
                className="h-5 w-5 text-primary"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="font-mono text-4xl font-bold leading-none tracking-tight text-fd-foreground sm:text-5xl">
                minutes
              </span>
              <span className="ml-auto font-heading text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
                to first trace
              </span>
            </div>
          </motion.div>
        </div>

        {/* ---- Payoff + CTA ---- */}
        <motion.div
          initial={REVEAL.initial}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ ...REVEAL.transition, delay: 0.55 }}
          className="mt-14 flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="max-w-md text-balance font-mono text-xs leading-relaxed text-fd-muted-foreground sm:text-sm">
            Same pipeline, none of the setup. Skip the week of plumbing and go
            straight to the data.
          </p>
          <a
            href="/docs/getting-started/install"
            className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-fd-border bg-fd-card/40 px-6 py-3 font-heading text-sm font-bold tracking-tight text-fd-foreground outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
          >
            Read the quickstart
            <ArrowRight
              className="h-4 w-4 text-primary transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
