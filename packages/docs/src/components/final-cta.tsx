import { Button } from "@everr/ui/components/button";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Copy } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

const INSTALL_COMMAND = "curl -fsSL https://everr.dev/install.sh | sh";

export function FinalCTA() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(INSTALL_COMMAND);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Clipboard unavailable (insecure context / denied permission) — no-op.
    }
  };

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
          className="mx-auto mt-12 flex w-full max-w-xl items-center gap-3 rounded-md border-2 border-fd-border bg-fd-card px-4 py-3.5 text-left"
        >
          <span
            aria-hidden
            className="select-none font-mono text-sm text-primary"
          >
            $
          </span>
          <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-fd-foreground">
            {INSTALL_COMMAND}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Copied" : "Copy install command"}
            className="-mr-1.5 shrink-0 rounded-md p-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-muted/50 hover:text-fd-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {copied ? (
              <Check className="size-4 text-primary" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
          </button>
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
