/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Preserve the existing status element and layout during the linter migration. */
import { findNavSection } from "@everr/telemetry-explorer/shell";
import { CopyStateContent } from "@everr/ui/components/copy-state-icon";
import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { cn } from "@everr/ui/lib/utils";
import { useLocation } from "@tanstack/react-router";
import { useRef } from "react";
import { navGroups } from "#app/lib/navigation.ts";

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
  const section = findNavSection(
    navGroups,
    useLocation({ select: (location) => location.pathname }),
  );
  const promptRef = useRef<HTMLElement>(null);
  const { state: copyState, copy: copyPrompt } = useCopyToClipboard(assistantPrompt, {
    selectOnFailure: promptRef,
  });

  return (
    <Empty className="border-0 py-16">
      <EmptyHeader className="max-w-lg">
        {section && (
          <EmptyMedia
            aria-hidden
            className={cn(
              section.group.accent,
              "size-10 rounded-xl bg-(--nav-accent)/12 text-(--nav-accent) [&_svg]:size-5",
            )}
          >
            <section.item.icon />
          </EmptyMedia>
        )}
        <EmptyTitle as="h2" className="text-xl font-bold">
          {title}
        </EmptyTitle>
        <EmptyDescription className="text-sm/relaxed">{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="mt-4 w-full max-w-2xl">
        <div className="flex w-full items-center gap-4 rounded-xl bg-card shadow-(--shadow-surface) py-3 pr-3 pl-5 text-left">
          <span
            aria-hidden
            className="select-none font-mono font-semibold text-muted-foreground text-sm"
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
            variant="outline"
            aria-label="Copy assistant prompt"
            className="shrink-0"
            onClick={copyPrompt}
          >
            <CopyStateContent copied={copyState === "copied"} label="Copy" />
          </Button>
        </div>
        <div
          role="status"
          className={cn("text-muted-foreground text-xs", copyState !== "failed" && "sr-only")}
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
