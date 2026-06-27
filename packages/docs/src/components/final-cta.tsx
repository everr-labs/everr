import { Button } from "@everr/ui/components/button";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { InstallCommand } from "./ui/install-command";

export function FinalCTA() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-5xl px-6 py-28 text-center md:py-40">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-20% 0px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="font-heading text-4xl leading-none sm:text-5xl md:text-6xl lg:text-7xl"
        >
          Stop guessing.
          <br />
          Start observing.
        </motion.h2>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-20% 0px" }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mt-12 w-full max-w-xl"
        >
          <InstallCommand className="border-2 py-3.5 text-left" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-20% 0px" }}
          transition={{ duration: 0.7, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
        >
          <Button
            variant="cta"
            size="xl"
            nativeButton={false}
            render={
              // biome-ignore lint/a11y/useAnchorContent: content is injected by Button
              <a href="https://app.everr.dev" />
            }
            className="w-full sm:w-auto"
          >
            Sign In <ArrowRight />
          </Button>

          <Button
            variant="outline"
            size="xl"
            nativeButton={false}
            render={<Link to="/docs/$" params={{ _splat: "" }} />}
            className="w-full sm:w-auto"
          >
            Documentation
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
