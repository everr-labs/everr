import { motion, useInView } from "motion/react";
import { useRef } from "react";
import skillvueLogo from "../assets/logos/skillvue.svg?url";
import marcelloPhoto from "../assets/testimonials/marcello.jpeg?url";
import { GravityStarsBackground } from "./animate-ui/components/backgrounds/gravity-stars";

export function FeaturedTestimonial() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section
      ref={ref}
      className="relative overflow-hidden border-y-2 border-fd-border bg-fd-background"
    >
      <GravityStarsBackground className="absolute inset-0" starsCount={300} />
      <div className="relative z-10 mx-auto max-w-5xl px-6 py-24 md:py-36">
        <motion.figure
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Why teams switch
          </p>

          <img src={skillvueLogo} alt="SkillVue" className="mt-6 h-8 w-auto" />

          <blockquote className="mt-6 font-heading text-2xl leading-[1.2] tracking-tight text-fd-foreground sm:text-3xl md:text-4xl">
            “The first tool we tried took a whole team just to keep running. We
            moved to something cheaper and still ended up paying{" "}
            <span className="text-primary">$700 a month</span> for data I
            couldn’t really explain. Everr is the first one the whole team
            actually uses. And it’s not a watered-down version, it does
            everything we need, we just don’t need anyone
            babysitting it.
            <br />
            <span className="text-primary">It’s how we work now</span>.”
          </blockquote>

          <figcaption className="mt-8 flex items-center gap-4">
            <img
              src={marcelloPhoto}
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
