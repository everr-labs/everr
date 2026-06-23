import { cn } from "@everr/ui/lib/utils";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { INSTALL_COMMAND } from "@/constants";

/**
 * The one true call to action: copy + run the install command.
 * Shared between the hero and the final CTA so both stay in sync.
 */
export function InstallCommand({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context / denied), the command is
      // still selectable in the <code> element, so this fails quietly.
    }
  };

  return (
    <div
      className={cn(
        "flex w-full items-center gap-3 rounded-md border-2 border-fd-border bg-fd-card px-4 py-3.5 text-left",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="select-none font-mono text-sm text-primary"
      >
        $
      </span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-fd-foreground sm:text-sm">
        {INSTALL_COMMAND}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Install command copied" : "Copy install command"}
        className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-sm px-2.5 py-2 font-heading text-xs font-bold uppercase tracking-[0.2em] text-fd-muted-foreground outline-2 outline-dotted outline-transparent outline-offset-2 ring-offset-background transition-colors hover:text-primary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-[3px]"
      >
        {copied ? (
          <Check className="size-4 text-primary" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
        <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
