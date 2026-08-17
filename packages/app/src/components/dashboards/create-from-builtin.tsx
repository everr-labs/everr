import { Button } from "@everr/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { Check, Copy, Sparkles } from "lucide-react";
import { useRef } from "react";
import { createFromBuiltinPrompt } from "@/data/dashboards/built-in/prompt";

/**
 * The only create path a built-in offers: hand the Agent a prompt that reads
 * the built-in through the resources API and applies an adapted copy as code.
 * There is no in-app create on purpose (ADR 0004) — a Dashboard made here
 * would exist in no repository, so apply could never reconcile it.
 */
export function CreateFromBuiltin({
  slug,
  name,
}: {
  slug: string;
  name: string;
}) {
  const prompt = createFromBuiltinPrompt({ slug, name });
  const promptRef = useRef<HTMLElement>(null);
  const { state: copyState, copy } = useCopyToClipboard(prompt, {
    selectOnFailure: promptRef,
  });

  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" />}>
        <Sparkles className="size-3.5" />
        Fork this dashboard
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <p className="text-muted-foreground text-xs/relaxed">
          Paste this into your coding assistant. It reads this built-in
          dashboard, saves an adapted copy as code in your repository, and
          applies it.
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
        <p aria-live="polite" className="sr-only">
          {copyState === "copied" && "Prompt copied to clipboard."}
          {copyState === "failed" &&
            "Couldn't access the clipboard. The prompt is selected, copy it manually."}
        </p>
        {copyState === "failed" && (
          <p className="mt-2 text-amber-400 text-xs">
            Couldn't access the clipboard. The prompt is selected, copy it
            manually.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
