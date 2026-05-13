import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function InstallCommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-2 border border-border bg-muted/50 px-4 py-3 font-mono text-sm rounded-md">
      <code className="flex-1 truncate text-xs">{command}</code>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Copy install command"
      >
        {copied ? (
          <Check className="size-4 text-green-400" />
        ) : (
          <Copy className="size-4" />
        )}
      </button>
    </div>
  );
}
