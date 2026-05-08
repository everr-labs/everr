import { Button } from "@everr/ui/components/button";
import { Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

const INSTALL_COMMAND = "curl -fsSL https://everr.dev/install.sh | sh";

export function FinalCTA() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
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
          transition={{
            duration: 0.7,
            delay: 0.15,
            ease: [0.22, 1, 0.36, 1],
          }}
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
            aria-label="Copy install command"
            className="flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-2 font-heading text-xs font-bold uppercase tracking-[0.2em] text-fd-muted-foreground outline-2 outline-dotted outline-transparent outline-offset-2 ring-offset-background transition-colors hover:text-primary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-[3px]"
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-20% 0px" }}
          transition={{
            duration: 0.7,
            delay: 0.45,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
        >
          <Button
            variant="cta"
            size="xl"
            nativeButton={false}
            render={<Link to="/waitlist" />}
            className="w-full sm:w-auto"
          >
            Join the waitlist
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

        {/*<motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-20% 0px" }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-8 font-heading text-[11px] uppercase tracking-[0.3em] text-fd-muted-foreground/60"
        >
          AI-native · OpenTelemetry-native · No account required
        </motion.p>*/}
      </div>
    </section>
  );
}
