import { buttonVariants } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { Loader2, X } from "lucide-react";
import type { SummarizerStatus } from "@/hooks/use-log-summarizer";

interface LogSummaryPanelProps {
  status: SummarizerStatus;
  summary: string;
  error: string | null;
  onClose: () => void;
}

function renderMarkdown(text: string) {
  // Simple markdown renderer for key-points output (bullet lists)
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.*)/);

    if (bulletMatch) {
      const indent = Math.floor((bulletMatch[1]?.length || 0) / 2);
      elements.push(
        <li
          key={i}
          className="ml-4"
          style={{ marginLeft: `${indent * 16 + 16}px` }}
        >
          {renderInlineMarkdown(bulletMatch[2])}
        </li>,
      );
    } else if (line.trim()) {
      elements.push(
        <p key={i} className="mb-1">
          {renderInlineMarkdown(line)}
        </p>,
      );
    }
  }

  return elements;
}

function renderInlineMarkdown(text: string): React.ReactNode {
  // Handle bold (**text**), italic (*text*), and inline code (`text`)
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)/s);
    if (boldMatch) {
      if (boldMatch[1]) {
        parts.push(boldMatch[1]);
      }
      parts.push(
        <strong key={key++} className="font-semibold">
          {boldMatch[2]}
        </strong>,
      );
      remaining = boldMatch[3];
      continue;
    }

    // Inline code
    const codeMatch = remaining.match(/^(.*?)`(.+?)`(.*)/s);
    if (codeMatch) {
      if (codeMatch[1]) {
        parts.push(codeMatch[1]);
      }
      parts.push(
        <code key={key++} className="bg-muted rounded px-1 py-0.5 font-mono">
          {codeMatch[2]}
        </code>,
      );
      remaining = codeMatch[3];
      continue;
    }

    // No more matches, push remainder
    parts.push(remaining);
    break;
  }

  return parts.length === 1 ? parts[0] : parts;
}

export function LogSummaryPanel({
  status,
  summary,
  error,
  onClose,
}: LogSummaryPanelProps) {
  const isLoading = status === "creating" || status === "summarizing";

  return (
    <div className="bg-muted/30 max-h-48 overflow-y-auto border-b text-xs">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="font-medium">Summary</span>
        <button
          type="button"
          onClick={onClose}
          className={cn(buttonVariants({ variant: "ghost", size: "icon-xs" }))}
        >
          <X className="size-3" />
        </button>
      </div>

      <div className="px-3 pb-2">
        {isLoading && (
          <div className="text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-3 animate-spin" />
            <span>
              {status === "creating"
                ? "Preparing summarizer..."
                : "Summarizing logs..."}
            </span>
          </div>
        )}

        {error && <div className="text-red-600 dark:text-red-400">{error}</div>}

        {summary && (
          <ul className="list-disc space-y-0.5">{renderMarkdown(summary)}</ul>
        )}
      </div>
    </div>
  );
}
