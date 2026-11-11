import { Tooltip, TooltipContent, TooltipTrigger } from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * A long identifier (a Fingerprint, a trace ID, a span ID) shown as its first
 * characters. A click copies the full value, and the tooltip shows it.
 */
export function CopyId({
  value,
  label,
  className,
}: {
  value: string;
  /** What the value is, for example "fingerprint". It names the control. */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  // In a list row the control sits above the stretched link of the row. The
  // guard stops the click before it reaches the router.
  const copy = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard?.writeText(value).then(() => setCopied(true));
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Copy ${label}`}
            className={cn(
              "text-muted-foreground hover:text-foreground group/copy-id relative z-10 inline-flex shrink-0 cursor-pointer items-center gap-1 font-mono text-xs font-normal",
              className,
            )}
            onClick={copy}
            onMouseLeave={() => setCopied(false)}
          />
        }
      >
        {value.slice(0, 8)}
        {copied ? (
          <Check className="size-3" />
        ) : (
          <Copy className="size-3 opacity-0 transition-opacity group-hover/copy-id:opacity-70 group-focus-visible/copy-id:opacity-70" />
        )}
      </TooltipTrigger>
      <TooltipContent>
        {copied ? "Copied!" : <span className="font-mono">{value}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
