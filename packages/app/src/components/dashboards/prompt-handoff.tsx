/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The status line is a live region that must stay mounted, visible or not. */
import { Button } from "@everr/ui/components/button";
import { CopyStateContent } from "@everr/ui/components/copy-state-icon";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { cn } from "@everr/ui/lib/utils";
import { type ReactNode, useRef } from "react";

/**
 * A built-in dashboard's action: a popover that hands the coding assistant a
 * prompt. One layout for every handoff, so the steps read the same each time:
 * what happens, the prompt, then the one button that matters.
 */
export function PromptHandoff({
  trigger,
  triggerVariant = "outline",
  title,
  description,
  prompt,
}: {
  /** Icon and label of the toolbar button. */
  trigger: ReactNode;
  /** Primary only when the handoff is the one thing to do on the page. The
   *  popover's own primary is "Copy prompt"; a primary trigger beside it
   *  would be two lime buttons asking for the same click. */
  triggerVariant?: "default" | "outline";
  title: string;
  description: ReactNode;
  prompt: string;
}) {
  const promptRef = useRef<HTMLElement>(null);
  const { state: copyState, copy } = useCopyToClipboard(prompt, {
    selectOnFailure: promptRef,
  });

  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant={triggerVariant} />}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-96 gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverDescription className="text-xs/relaxed">{description}</PopoverDescription>
        </PopoverHeader>
        {/* Capped, so a long prompt scrolls inside the card instead of
            pushing the button out of reach. */}
        <code
          ref={promptRef}
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region has to take focus, or a keyboard user cannot scroll it.
          tabIndex={0}
          className="max-h-52 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2.5 font-mono text-[0.6875rem]/relaxed whitespace-pre-wrap break-words text-foreground/90 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {prompt}
        </code>
        <Button type="button" size="sm" onClick={copy}>
          <CopyStateContent
            copied={copyState === "copied"}
            label="Copy prompt"
            iconClassName="size-3.5"
          />
        </Button>
        {/* One status line serves sighted and screen-reader users alike:
            visible on failure, announced-only for the transient "copied". */}
        <p
          role="status"
          className={cn("text-warning text-xs", copyState !== "failed" && "sr-only")}
        >
          {copyState === "copied" && "Prompt copied to clipboard."}
          {copyState === "failed" &&
            "Couldn't access the clipboard. The prompt is selected, copy it manually."}
        </p>
      </PopoverContent>
    </Popover>
  );
}
