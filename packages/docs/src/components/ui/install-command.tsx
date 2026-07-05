import { cn } from "@everr/ui/lib/utils";
import { Check, Copy } from "lucide-react";
import { useCopyToClipboard } from "../../lib/use-copy";

export const INSTALL_COMMAND = "curl -fsSL https://everr.dev/install.sh | sh";

/** The one-line install command in a copyable terminal box. Container styling
 *  (border, background, width) is overridable via `className`. */
export function InstallCommand({ className }: { className?: string }) {
  const { copied, copy } = useCopyToClipboard(INSTALL_COMMAND);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border border-fd-border bg-fd-card px-4 py-3",
        className,
      )}
    >
      <span aria-hidden className="select-none font-mono text-sm text-primary">
        $
      </span>
      <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-fd-foreground">
        {INSTALL_COMMAND}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
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
  );
}
