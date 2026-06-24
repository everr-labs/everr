import { motion, useInView } from "motion/react";
import { useRef } from "react";

export function FeaturedTestimonial() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section
      ref={ref}
      className="relative overflow-hidden border-y-2 border-fd-border bg-fd-background"
    >
      <div className="mx-auto max-w-5xl px-6 py-24 md:py-36">
        <motion.figure
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Why teams switch
          </p>

          <img
            src="/logos/skillvue.svg"
            alt="SkillVue"
            className="mt-6 h-8 w-auto"
          />

          <blockquote className="mt-6 font-heading text-2xl leading-[1.2] tracking-tight text-fd-foreground sm:text-3xl md:text-4xl">
            “Our first platform needed a dedicated team just to stand up. The
            next one was easier, but we were paying{" "}
            <span className="text-primary">$700 a month</span> for data we
            couldn’t even account for. Everr is the first observability platform
            simple enough that the whole team actually uses it —{" "}
            <span className="text-primary">
              and every bit as powerful as the heavyweight tools we left behind
            </span>
            . It just became how we work.”
          </blockquote>

          <figcaption className="mt-8 flex items-center gap-4">
            <img
              src="/testimonials/marcello.jpeg"
              alt="Marcello Roherssen"
              className="size-12 rounded-full object-cover"
            />
            <div className="text-sm">
              <div className="font-heading font-bold text-fd-foreground">
                Marcello Roherssen
              </div>
              <div className="text-fd-muted-foreground">CTO · SkillVue</div>
            </div>
          </figcaption>
        </motion.figure>
      </div>
    </section>
  );
}
