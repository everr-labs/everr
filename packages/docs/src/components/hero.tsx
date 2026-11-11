import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { HeroWatch } from "@/components/hero-watch/HeroWatch";
import { Button } from "@/components/ui/button";
import { SIGN_UP_URL } from "@/constants";
import { m } from "@/paraglide/messages";

const ease = [0.16, 1, 0.3, 1] as const;

// How many letters one line of the headline holds at full size. A longer line, as some
// languages need, sets the headline smaller so it still takes one line.
const LINE_FITS = 19;

export function Hero() {
  const lines = [m.hero_line_1(), m.hero_line_2()];
  const fit: CSSProperties & Record<"--fit", number> = {
    "--fit": Math.min(1, LINE_FITS / Math.max(...lines.map((line) => line.length))),
  };
  return (
    <section className="relative -mt-16 min-h-[max(100svh,46rem)] overflow-hidden bg-background pt-16 text-foreground md:-mt-24 md:pt-24">
      <div className="relative z-10 mx-auto max-w-7xl px-4 pt-10 sm:px-6 md:pt-[clamp(1rem,3vh,3rem)]">
        <h1
          className="display text-[clamp(2.375rem,min(9vw,14.5vh),9rem)] md:text-[calc(clamp(2.375rem,min(9vw,14.5vh),9rem)*var(--fit))]"
          style={fit}
        >
          {lines.map((line, i) => (
            // The clip is taller than the line box, so descenders survive the reveal
            <span key={line} className="-mb-[0.14em] block overflow-hidden pb-[0.14em]">
              <motion.span
                className="block"
                initial={{ y: "110%" }}
                animate={{ y: 0 }}
                transition={{ duration: 0.9, delay: 0.05 + i * 0.09, ease }}
              >
                {line}
              </motion.span>
            </span>
          ))}
        </h1>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35, ease }}
          className="mt-7 max-w-[30rem] md:mt-10"
        >
          <p className="text-lg leading-[1.5] text-pretty text-foreground/75 md:text-xl">
            {m.hero_lead()}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              nativeButton={false}
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- content is injected by Button
              render={<a href={SIGN_UP_URL} />}
            >
              {m.get_started()}
            </Button>
            <Button
              variant="secondary"
              nativeButton={false}
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- content is injected by Button
              render={<a href="#tour" />}
            >
              {m.hero_secondary()}
            </Button>
          </div>
        </motion.div>
      </div>

      {/* Pieces of an app with Everr keeping watch over them, running off the page's corner */}
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 1.3, delay: 0.4, ease }}
        className="relative mt-8 ml-auto w-[min(100vw,30rem)] md:absolute md:right-0 md:bottom-0 md:mt-0 md:w-[clamp(30rem,min(53vw,(72svh-9.5rem)*1.41),95rem)]"
      >
        <HeroWatch />
      </motion.div>
    </section>
  );
}
