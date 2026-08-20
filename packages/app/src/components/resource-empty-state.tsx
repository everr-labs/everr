import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { cn } from "@everr/ui/lib/utils";
import { useRef } from "react";

/**
 * Empty state for resources managed as code (alerts, dashboards, runbooks):
 * a copyable assistant prompt that sets up the first resource, plus an
 * optional docs link for writing the YAML by hand.
 */
export function ResourceEmptyState({
  title,
  description,
  assistantPrompt,
  docsHref,
}: {
  title: string;
  description: string;
  assistantPrompt: string;
  docsHref?: string;
}) {
  const promptRef = useRef<HTMLElement>(null);
  const { state: copyState, copy: copyPrompt } = useCopyToClipboard(
    assistantPrompt,
    { selectOnFailure: promptRef },
  );

  return (
    <Empty className="border-0 py-16">
      <EmptyHeader className="max-w-lg">
        <EmptyTitle as="h2" className="text-xl font-bold">
          {title}
        </EmptyTitle>
        <EmptyDescription className="text-sm/relaxed">
          {description}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="mt-4 w-full max-w-2xl">
        <div className="flex w-full items-center gap-4 rounded-xl border bg-muted/30 py-3 pr-3 pl-5 text-left">
          <span
            aria-hidden
            className="select-none font-mono font-semibold text-primary text-sm"
          >
            {">_"}
          </span>
          <code
            ref={promptRef}
            className="min-w-0 flex-1 font-medium text-foreground/90 text-sm/relaxed"
          >
            {assistantPrompt}
          </code>
          <Button
            type="button"
            size="sm"
            aria-label="Copy assistant prompt"
            className="min-w-16 shrink-0"
            onClick={copyPrompt}
          >
            {copyState === "copied" ? "Copied" : "Copy"}
          </Button>
        </div>
        <div
          role="status"
          className={cn(
            "text-muted-foreground text-xs",
            copyState !== "failed" && "sr-only",
          )}
        >
          {copyState === "copied" && "Prompt copied to clipboard."}
          {copyState === "failed" &&
            "Couldn't access the clipboard. The prompt is selected, copy it manually."}
        </div>
        {docsHref && (
          <EmptyDescription>
            Or write the YAML yourself and publish it with the everr CLI.{" "}
            <a href={docsHref} target="_blank" rel="noreferrer">
              Read the guide
            </a>
          </EmptyDescription>
        )}
      </EmptyContent>
    </Empty>
  );
}
