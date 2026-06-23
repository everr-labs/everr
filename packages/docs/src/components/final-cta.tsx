import { Button } from "@everr/ui/components/button";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { GITHUB_URL } from "@/constants";
import { InstallCommand } from "./install-command";

const EASE = [0.22, 1, 0.36, 1] as const;

export function FinalCTA() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-3xl px-6 py-28 text-center md:py-40">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-20% 0px" }}
          transition={{ duration: 0.7, ease: EASE }}
          className="font-heading text-4xl leading-none sm:text-5xl md:text-6xl lg:text-7xl"
        >
          <span className="text-primary">Everr</span>y second counts.
        </motion.h2>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-20% 0px" }}
          transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
          className="mx-auto mt-12 flex max-w-xl flex-col items-center gap-3"
        >
          <InstallCommand />
          <p className="font-mono text-xs text-fd-muted-foreground">
            Try it yourself · macOS &amp; Linux
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-20% 0px" }}
          transition={{ duration: 0.7, delay: 0.25, ease: EASE }}
          className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
        >
          <Button
            variant="outline"
            size="xl"
            nativeButton={false}
            render={<Link to="/docs/$" params={{ _splat: "" }} />}
            className="w-full sm:w-auto"
          >
            Documentation
          </Button>
          <Button
            variant="ghost"
            size="xl"
            nativeButton={false}
            className="w-full sm:w-auto"
            render={
              // biome-ignore lint/a11y/useAnchorContent: content is injected
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" />
            }
          >
            <SiGithub className="size-5" />
            GitHub
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
