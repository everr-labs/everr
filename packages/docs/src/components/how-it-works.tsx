import { motion, useInView } from "motion/react";
import { useRef } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

type Step = {
  n: string;
  title: string;
  body: string;
  code: { prompt: string; comment?: string; text: string } | null;
};

const STEPS: Step[] = [
  {
    n: "01",
    title: "Setup OpenTelemetry",
    body: "Tell your agent to use the Everr skill and instrument the app properly, with the right spans, logs, and metrics for your stack.",
    code: {
      prompt: ">",
      comment: "# in your coding agent",
      text: "/everr-setup-telemetry",
    },
  },
  {
    n: "02",
    title: "Run locally",
    body: "Generate real traffic on your machine and make sure the traces, logs, metrics, and errors land where you expect, before any of it ships.",
    code: null,
  },
  {
    n: "03",
    title: "Interrogate it",
    body: "Query Everr yourself using SQL, or have your agent investigate what's slow, noisy, or missing.",
    code: {
      prompt: "$",
      text: 'everr cloud query "SELECT trace.name, duration_ms FROM traces ORDER BY duration_ms DESC LIMIT 10"',
    },
  },
  {
    n: "04",
    title: "Ship what works",
    body: "Turn the useful signals into dashboards, runbooks, and alerts. Keep only the monitoring that earns its place.",
    code: null,
  },
];

export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section
      ref={ref}
      className="relative overflow-hidden border-y-2 border-fd-border bg-fd-card/30"
    >
      <div className="mx-auto max-w-7xl py-24">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <h2 className="text-balance font-heading text-3xl leading-[1.08] tracking-tight sm:text-4xl md:text-5xl">
            Give Everr a try.{" "}
            <span className="relative everr-decoration everr-decoration-primary">
              You&rsquo;ll love it
            </span>
            .
          </h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Your observability setup should go through the same loop as your
            code: run it, inspect it, fix it, repeat.
          </p>
        </motion.div>

        <ol className="mt-16 md:mt-20">
          {STEPS.map((step, i) => (
            <li
              key={step.n}
              className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 pb-12 last:pb-0 sm:gap-x-8"
            >
              {/* number rail + connector */}
              <div className="relative flex justify-center">
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-1/2 top-5 h-full w-px -translate-x-1/2 bg-fd-border"
                  />
                )}
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={inView ? { opacity: 1, scale: 1 } : undefined}
                  transition={{
                    duration: 0.5,
                    delay: 0.2 + i * 0.12,
                    ease: EASE,
                  }}
                  className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-fd-border bg-fd-background font-heading text-sm font-bold text-primary"
                >
                  {step.n}
                </motion.span>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={inView ? { opacity: 1, y: 0 } : undefined}
                transition={{
                  duration: 0.6,
                  delay: 0.28 + i * 0.12,
                  ease: EASE,
                }}
                className="pt-1.5"
              >
                <h3 className="font-heading text-xl font-bold text-fd-foreground">
                  {step.title}
                </h3>
                <p className="mt-2 max-w-xl text-base leading-relaxed text-fd-muted-foreground">
                  {step.body}
                </p>
                {step.code && (
                  <pre className="mt-4 max-w-xl overflow-x-auto rounded-md border border-fd-border bg-fd-background/70 px-4 py-3 font-mono text-[12px] leading-relaxed sm:text-[13px]">
                    {step.code.comment && (
                      <span className="block text-fd-muted-foreground">
                        {step.code.comment}
                      </span>
                    )}
                    <code className="text-fd-foreground">
                      <span className="select-none text-primary">
                        {step.code.prompt}{" "}
                      </span>
                      {step.code.text}
                    </code>
                  </pre>
                )}
              </motion.div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
