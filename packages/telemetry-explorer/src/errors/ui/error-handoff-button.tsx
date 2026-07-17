import { Button } from "@everr/ui/components/button";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ErrorIssueSummary } from "../data/types";
import {
  ERROR_FINGERPRINT_SQL,
  EXCEPTION_LOG_FILTER_SQL,
} from "../sql/fingerprint";

// A ready-to-run query that lists this Error's Occurrences: the same
// exception-log filter and fingerprint expression the app groups Errors by
// (documented in the everr-use-telemetry skill), narrowed to one Fingerprint.
function occurrencesQuery(fingerprint: string): string {
  return [
    "SELECT toString(Timestamp) AS timestamp, ServiceName, TraceId,",
    "  LogAttributes['exception.stacktrace'] AS stacktrace",
    "FROM logs",
    "WHERE Timestamp > now() - INTERVAL 7 DAY",
    `  AND ${EXCEPTION_LOG_FILTER_SQL.trim()}`,
    `  AND (${ERROR_FINGERPRINT_SQL.trim()}) = '${fingerprint}'`,
    "ORDER BY Timestamp DESC",
    "LIMIT 50",
  ].join("\n");
}

// Agent-agnostic by design: the goal, the Fingerprint, and a telemetry query
// the agent runs itself. No deep links, no per-agent launchers.
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
    `Pull this Error's Occurrences from telemetry with \`everr cloud query\` (or \`everr local query\` for local telemetry):`,
    ``,
    occurrencesQuery(issue.fingerprint),
    ``,
    `Then investigate the root cause and fix the code. The everr-use-telemetry skill documents how Errors are fingerprinted.`,
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
