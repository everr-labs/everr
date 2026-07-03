import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
} from "@everr/ui/components/empty";
import { cn } from "@everr/ui/lib/utils";
import { type RefObject, useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

function CopyPromptButton({
  prompt,
  promptRef,
  onStateChange,
}: {
  prompt: string;
  promptRef: RefObject<HTMLElement | null>;
  onStateChange: (state: CopyState) => void;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const transition = (next: CopyState) => {
    setState(next);
    onStateChange(next);
    clearTimeout(resetTimer.current);
    // "Copied" is transient feedback; a failure stays visible until the next
    // attempt so the user has time to copy the selected text manually.
    if (next === "copied") {
      resetTimer.current = setTimeout(() => {
        setState("idle");
        onStateChange("idle");
      }, 2000);
    }
  };

  // Clipboard access can be denied (permissions policy, unfocused document).
  // Select the prompt text so a manual copy is one keystroke away.
  const selectPrompt = () => {
    const node = promptRef.current;
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  return (
    <Button
      type="button"
      size="sm"
      aria-label="Copy assistant prompt"
      className="min-w-16 shrink-0"
      onClick={() => {
        navigator.clipboard.writeText(prompt).then(
          () => transition("copied"),
          () => {
            selectPrompt();
            transition("failed");
          },
        );
      }}
    >
      {state === "copied" ? "Copied" : "Copy"}
    </Button>
  );
}

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
  const [copyState, setCopyState] = useState<CopyState>("idle");

  return (
    <Empty className="border-0 py-16">
      <EmptyHeader className="max-w-lg">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
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
          <CopyPromptButton
            prompt={assistantPrompt}
            promptRef={promptRef}
            onStateChange={setCopyState}
          />
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
