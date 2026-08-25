import { Button } from "@everr/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { cn } from "@everr/ui/lib/utils";
import { Check, ClipboardList, Copy } from "lucide-react";
import { useRef } from "react";
import { instrumentMissingPrompt } from "@/data/dashboards/built-in/prompt";

/**
 * Appears on a built-in dashboard whose telemetry requirements are unmet.
 * Instead of forking the dashboard (which would produce empty panels), this
 * hands the Agent a prompt that investigates and sets up the missing
 * instrumentation.
 */
export function InstrumentFromBuiltin({
  name,
  missing,
}: {
  name: string;
  missing: string[];
}) {
  const prompt = instrumentMissingPrompt({ name, missing });
  const promptRef = useRef<HTMLElement>(null);
  const { state: copyState, copy } = useCopyToClipboard(prompt, {
    selectOnFailure: promptRef,
  });

  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" />}>
        <ClipboardList className="size-3.5" />
        Set up instrumentation
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <p className="text-muted-foreground text-xs/relaxed">
          Paste this into your coding assistant. It checks what instrumentation
          is needed and sets it up so this dashboard can render.
        </p>
        <div className="mt-3 flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
          <code
            ref={promptRef}
            className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[0.6875rem]/relaxed text-foreground/90"
          >
            {prompt}
          </code>
        </div>
        <Button
          type="button"
          size="sm"
          className="mt-3 w-full"
          onClick={copy}
          aria-label="Copy assistant prompt"
        >
          {copyState === "copied" ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copyState === "copied" ? "Copied" : "Copy prompt"}
        </Button>
        {/* One status line serves sighted and screen-reader users alike:
            visible on failure, announced-only for the transient "copied". */}
        <p
          role="status"
          className={cn(
            "mt-2 text-amber-400 text-xs",
            copyState !== "failed" && "sr-only",
          )}
        >
          {copyState === "copied" && "Prompt copied to clipboard."}
          {copyState === "failed" &&
            "Couldn't access the clipboard. The prompt is selected, copy it manually."}
        </p>
      </PopoverContent>
    </Popover>
  );
}
