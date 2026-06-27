import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, Check, Copy } from "lucide-react";
import { motion, useInView } from "motion/react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Content                                                            */
/* ------------------------------------------------------------------ */

const OLD_WAY_STEPS = [
  "Hand-instrument every service",
  "Settle on attribute names",
  "Get trace context to propagate",
  "Stitch logs to traces by hand",
  "Build dashboards from scratch",
  "Decide what to alert on",
  "Debug why no data shows up",
] as const;

/** What the installer prints as it runs. The last line is the payoff. */
const INSTALL_OUTPUT = [
  "everr CLI installed",
  "agent skills installed",
  "local collector listening on :4317",
  "first trace received",
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
      // Clipboard unavailable (insecure context / denied permission); no-op.
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
          {/* LEFT — the old way (dimmed, draining) */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.85, delay: 0.15, ease: EASE }}
            className="flex flex-col rounded-2xl border border-dashed border-fd-border bg-fd-card/40 p-6 sm:p-8 md:rounded-r-none md:border-r-0"
          >
            <ColumnTag label="The old way" tone="muted" />

            {/* The wall of yak-shaving */}
            <ol className="mt-7 flex-1 space-y-2">
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
                  className="flex items-baseline gap-3"
                >
                  <span className="font-mono text-[10px] tabular-nums text-fd-muted-foreground/30">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm leading-snug text-fd-muted-foreground/55 line-through decoration-fd-muted-foreground/25">
                    {step}
                  </span>
                </motion.li>
              ))}
            </ol>

            {/* Time tag */}
            <div className="mt-8 flex items-baseline gap-3 border-t border-dashed border-fd-border/50 pt-6">
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
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-fd-border bg-fd-background font-heading text-xs font-bold uppercase tracking-[0.15em] text-fd-muted-foreground shadow-lg">
              vs
            </span>
          </div>

          {/* RIGHT — with Everr (light, fast) */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.85, delay: 0.3, ease: EASE }}
            className="flex flex-col rounded-2xl border border-fd-border bg-fd-card p-6 shadow-lg shadow-black/20 sm:p-8 md:rounded-l-none"
          >
            <ColumnTag label="With Everr" tone="plain" />

            {/* The command, then the installer running */}
            <div className="mt-7 overflow-hidden rounded-xl border border-fd-border bg-fd-background">
              {/* titlebar — the try-it-out action, right-aligned */}
              <div className="flex items-center justify-end border-b border-fd-border px-3 py-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label={copied ? "Copied" : "Copy command"}
                  className={cn(
                    "group inline-flex items-center gap-2 rounded-md border px-3 py-1.5 font-heading text-xs font-bold tracking-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
                    copied
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-fd-border bg-fd-card text-fd-muted-foreground hover:border-fd-border/80 hover:text-fd-foreground",
                  )}
                >
                  {copied ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    <Copy className="size-3.5" aria-hidden />
                  )}
                  {copied ? "Copied" : "Try it out"}
                </button>
              </div>

              {/* command — one line */}
              <div className="overflow-x-auto px-5 py-5 [scrollbar-width:thin]">
                <code className="whitespace-nowrap font-mono text-base sm:text-lg">
                  <span
                    className="select-none text-fd-muted-foreground/40"
                    aria-hidden
                  >
                    $
                  </span>{" "}
                  <span className="text-fd-foreground">{COMMAND}</span>
                </code>
              </div>

              {/* installer output */}
              <div className="space-y-1.5 border-t border-fd-border/60 px-5 py-4">
                {INSTALL_OUTPUT.map((line, i) => {
                  const done = i === INSTALL_OUTPUT.length - 1;
                  return (
                    <motion.div
                      key={line}
                      initial={{ opacity: 0 }}
                      animate={inView ? { opacity: 1 } : undefined}
                      transition={{
                        duration: 0.4,
                        delay: 0.6 + i * 0.12,
                        ease: EASE,
                      }}
                      className="flex items-baseline gap-2 font-mono text-[12.5px] leading-relaxed"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "select-none",
                          done ? "text-primary" : "text-fd-muted-foreground/40",
                        )}
                      >
                        {done ? "→" : "✓"}
                      </span>
                      <span
                        className={
                          done
                            ? "text-fd-foreground"
                            : "text-fd-muted-foreground"
                        }
                      >
                        {line}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-fd-muted-foreground">
              The <Code>everr</Code> installer sets up the CLI, agent skills,
              and a local collector. The collector lets you build and validate
              telemetry locally; the skills let your coding agent instrument the
              codebase and take it to production.
            </p>

            <div className="flex-1" />

            {/* Time tag */}
            <div className="mt-8 flex items-baseline gap-3 border-t border-fd-border pt-6">
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
            className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-fd-border bg-fd-card/40 px-6 py-3 font-heading text-sm font-bold tracking-tight text-fd-foreground outline-none transition-colors hover:border-fd-border/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
          >
            Read the quickstart
            <ArrowRight
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </a>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared pieces                                                      */
/* ------------------------------------------------------------------ */

function ColumnTag({
  label,
  tone,
}: {
  label: string;
  tone: "muted" | "plain";
}) {
  return (
    <h3
      className={cn(
        "font-heading text-xs font-bold uppercase tracking-[0.25em]",
        tone === "plain" ? "text-fd-foreground" : "text-fd-muted-foreground/70",
      )}
    >
      {label}
    </h3>
  );
}

/** Inline monospace chip for an identifier such as the CLI name. */
function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-[0.85em] text-fd-foreground">
      {children}
    </code>
  );
}
