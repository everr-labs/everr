import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";

export function FinalCTA() {
  return (
    <section className="border-y border-border bg-card/50 text-foreground">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-10% 0px" }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto max-w-5xl px-6 py-28 text-center md:py-40"
      >
        <h2 className="mx-auto max-w-[18ch] text-balance font-heading text-[clamp(40px,6vw,76px)] leading-[1.05] tracking-[-0.04em]">
          See <span className="text-primary">what matters</span> in your app.
        </h2>
        <p className="mx-auto mt-7 max-w-[55ch] text-lg leading-[1.6] text-muted-foreground">
          Everr guides you through setup, then helps you monitor and investigate
          with the context you need.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button
            nativeButton={false}
            render={
              // biome-ignore lint/a11y/useAnchorContent: content is injected by Button
              <a href="https://app.everr.dev/auth/sign-up" />
            }
          >
            Get started
          </Button>
          <Button
            variant="secondary"
            nativeButton={false}
            render={<Link to="/docs/$" params={{ _splat: "" }} />}
          >
            Read the docs
          </Button>
        </div>
      </motion.div>
    </section>
  );
}
