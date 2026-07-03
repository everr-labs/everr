import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { useState } from "react";

function CopyPromptButton({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      size="sm"
      className="min-w-16 shrink-0"
      onClick={() => {
        void navigator.clipboard.writeText(prompt).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/**
 * Empty state for resources managed as code (alerts, dashboards, runbooks):
 * a copyable assistant prompt that sets up the first resource.
 */
export function ResourceEmptyState({
  title,
  description,
  assistantPrompt,
}: {
  title: string;
  description: string;
  assistantPrompt: string;
}) {
  return (
    <Empty className="border-0 py-16">
      <EmptyHeader className="max-w-lg">
        <EmptyTitle className="text-xl font-bold">{title}</EmptyTitle>
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
          <code className="min-w-0 flex-1 font-medium text-foreground/90 text-sm/relaxed">
            {assistantPrompt}
          </code>
          <CopyPromptButton prompt={assistantPrompt} />
        </div>
      </EmptyContent>
    </Empty>
  );
}
