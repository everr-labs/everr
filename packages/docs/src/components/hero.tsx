import { Button } from "@everr/ui/components/button";
import { Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { HexagonPattern } from "./hexagon-pattern";

const INSTALL_COMMAND = "curl -fsSL https://everr.dev/install.sh | sh";

export function Hero() {
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
    <div className="relative overflow-hidden md:flex md:min-h-[100svh] md:items-end">
      <div className="w-full px-6 pb-12 pt-28 sm:px-8 sm:pb-16 sm:pt-32 md:mb-24 md:px-12 md:pb-0 md:pt-0">
        <h1
          style={{ animationDelay: "0.3s" }}
          className="animate-fade-up font-heading text-5xl leading-[1.02] sm:text-6xl sm:leading-[1.05] md:text-7xl md:leading-[1.1] lg:text-8xl/24 lg:max-w-[66%]"
        >
          Observing production systems is{" "}
          <span className="relative everr-decoration everr-decoration-primary m-0">
            too late
          </span>
        </h1>

        <div
          className="prose animate-fade-up mb-6 mt-6 max-w-3xl text-base text-fd-muted-foreground sm:text-lg md:mt-10 md:mb-4"
          style={{ animationDelay: "0.5s" }}
        >
          <p className="hidden sm:block">
            Observability today is trapped behind dashboards, and most "AI
            integrations" are just legacy tooling with a ChatGPT wrapper slapped
            on top.
          </p>
          <p>
            Everr gives you — and your AI agents — direct access to the signals
            that matter. Wherever your code runs: locally, in CI, inside remote
            sandboxes.
          </p>
          <p className="hidden sm:block">
            No context switching. No black boxes. Just observability built for
            the AI-native era.
          </p>
        </div>

        {/* Mobile-only CTA — phones can't run the install command, send them
            to the waitlist instead. */}
        <div
          className="animate-fade-up md:hidden"
          style={{ animationDelay: "0.8s" }}
        >
          <Button
            variant="cta"
            size="xl"
            nativeButton={false}
            render={<Link to="/waitlist" />}
            className="w-full"
          >
            Join the waitlist
          </Button>
        </div>

        {/* Desktop install command */}
        <div
          className="hidden w-full max-w-xl animate-fade-up items-center gap-3 rounded-md border-2 border-fd-border bg-fd-card px-4 py-3.5 md:flex"
          style={{ animationDelay: "0.8s" }}
        >
          <span
            aria-hidden="true"
            className="select-none font-mono text-sm text-primary"
          >
            $
          </span>
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-fd-foreground">
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
        </div>
      </div>
      <HexagonPattern
        gap={6}
        radius={48}
        strokeDasharray="8,3"
        className="-z-10"
      />
    </div>
  );
}
