import { Button } from "@everr/ui/components/button";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ErrorIssueSummary } from "../data/types";

// Agent-agnostic by design: the goal, the Fingerprint, and the instruction to
// pull full context through the errors CLI. No deep links, no per-agent
// launchers.
export function buildErrorHandoffPrompt(issue: ErrorIssueSummary): string {
  const title = issue.exceptionType || "Unknown exception";
  const message = issue.exceptionMessage || issue.body;
  const heading = message ? `${title}: ${message}` : title;
  return [
    `Fix this Error tracked in Everr.`,
    ``,
    `Error: ${heading}`,
    `Fingerprint: ${issue.fingerprint}`,
    ``,
    `Run \`everr cloud errors show ${issue.fingerprint}\` for full context: message, stacktrace, and Occurrences with trace links. Then investigate the root cause and fix the code.`,
  ].join("\n");
}

export function ErrorHandoffButton({ issue }: { issue: ErrorIssueSummary }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Cancel a pending "Copied" reset if the dialog closes before it fires.
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildErrorHandoffPrompt(issue));
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      title="Copy a prompt that hands this Error to an agent"
      onClick={handleCopy}
    >
      {copied ? (
        <Check data-icon="inline-start" />
      ) : (
        <Copy data-icon="inline-start" />
      )}
      {copied ? "Copied" : "Copy agent prompt"}
    </Button>
  );
}
