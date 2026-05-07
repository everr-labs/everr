import { motion, useInView } from "motion/react";
import { useRef } from "react";

export function Species() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section
      ref={ref}
      className="relative overflow-hidden border-y-2 border-fd-border bg-fd-background"
    >
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        {/* Two-tone headline */}
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-5xl font-heading text-3xl leading-[1.15] tracking-tight sm:text-4xl md:text-5xl"
        >
          <span className="text-primary">A new kind of observability.</span>{" "}
          <span className="text-fd-foreground">
            Built where the work actually happens - your laptop, CI, and the
            agents shipping alongside you.
            <br />
            Not after-the-fact graphs.
          </span>
        </motion.h2>
      </div>
    </section>
  );
}
