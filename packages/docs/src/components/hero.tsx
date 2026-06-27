import { Button } from "@everr/ui/components/button";
import { Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { HoleBackground } from "./animate-ui/components/backgrounds/hole";

const INSTALL_COMMAND = "curl -fsSL https://everr.dev/install.sh | sh";

export function Hero() {
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
    <div className="relative overflow-x-clip md:aspect-video md:max-h-svh md:overflow-hidden">
      <div className="@container-size absolute inset-0 overflow-hidden">
        <HoleBackground className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 aspect-video h-auto w-[max(100cqw,177.78cqh)]" />
      </div>
      <div className="relative z-10 mx-auto flex max-w-7xl flex-col gap-8 px-6 py-16 md:grid md:h-full md:grid-cols-2 md:items-center md:py-0 md:px-8">
        <div className="flex flex-col gap-8">
          <h1 className="font-heading text-4xl md:text-6xl">
            Observability made simple.
            <br />
            <span className="text-primary">For Real.</span>
          </h1>
          <p className="max-w-prose">
            Setting up observability shouldn&rsquo;t take days. Get started in
            minutes.
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex w-full max-w-lg items-center gap-3 rounded-md border border-fd-border bg-fd-card/70 px-4 py-3 backdrop-blur-sm">
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
            </div>
          </div>
          <div>
            <Button
              variant="secondary"
              size="xl"
              nativeButton={false}
              render={<Link to="/docs/$" params={{ _splat: "" }} />}
            >
              Read the docs
            </Button>
          </div>
        </div>
        <div className="perspective-[1600px] perspective-origin-left">
          <div className="bg-card aspect-3/2 w-full overflow-hidden rounded-md border border-card shadow-2xl md:aspect-auto md:h-100 md:w-150 md:-rotate-y-25">
            <img
              src="/screenshot.png"
              alt="Screenshot"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
