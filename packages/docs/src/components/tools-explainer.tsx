import { Boxes, FileCode, Terminal } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

type Pillar = {
  icon: ReactNode;
  title: string;
  body: string;
};

const PILLARS: Pillar[] = [
  {
    icon: <Boxes className="size-6" />,
    title: "OpenTelemetry",
    body: "The standard already supports the languages and frameworks you run. No proprietary agent, no rewrite.",
  },
  {
    icon: <Terminal className="size-6" />,
    title: "SQL",
    body: "Query all your telemetry with plain SQL. Agents already speak it, and it's expressive enough for real telemetry work.",
  },
  {
    icon: <FileCode className="size-6" />,
    title: "Perses & Markdown",
    body: "Dashboards are Perses, runbooks are Markdown. Plain files your LLM already understands.",
  },
];

export function ToolsExplainer() {
  const reduced = useReducedMotion();

  const reveal = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 24 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-12% 0px" },
          transition: { duration: 0.7, delay, ease: EASE },
        };

  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-6 py-20 md:py-24">
        <motion.div {...reveal(0)} className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance font-heading text-4xl leading-[1.05] sm:text-5xl md:text-6xl">
            Built on standards,{" "}
            <span className="relative everr-decoration everr-decoration-primary">
              no lock-in
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground sm:text-lg">
            Standards make the whole system easier to work with. Everr builds on
            the ones you and your agents already know, so nothing here is yours
            to be trapped in.
          </p>
        </motion.div>

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-3 md:mt-20 md:gap-8">
          {PILLARS.map((pillar, i) => (
            <motion.div
              key={pillar.title}
              {...reveal(0.1 + i * 0.1)}
              className="rounded-xl border-2 border-fd-border bg-fd-card/40 p-6 md:p-8"
            >
              <span className="flex size-12 items-center justify-center rounded-lg border border-fd-border bg-fd-background text-primary">
                {pillar.icon}
              </span>
              <h3 className="mt-5 font-heading text-xl font-bold text-fd-foreground">
                {pillar.title}
              </h3>
              <p className="mt-2 text-base leading-relaxed text-fd-muted-foreground">
                {pillar.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
