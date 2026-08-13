import { Button } from "@everr/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { cn } from "@everr/ui/lib/utils";
import { Sparkles } from "lucide-react";
import { useRef } from "react";
import { editDashboardPrompt } from "@/data/dashboards/ui-owned";

/**
 * The edit path for a Dashboard: hand the Agent a prompt that names this
 * Dashboard, and let it read, change and apply the YAML.
 *
 * There is no editor UI on purpose. A Dashboard is a document reconciled by
 * apply, so the only writer that keeps as-code and the app in step is the one
 * that goes through apply — which is what the Agent already does through the
 * `everr-setup-resources` Skill.
 */
export function EditWithAssistant({
  project,
  slug,
  name,
  uiOwned,
}: {
  project: string;
  slug: string;
  name: string;
  uiOwned: boolean;
}) {
  const prompt = editDashboardPrompt({ project, slug, name, uiOwned });
  const promptRef = useRef<HTMLElement>(null);
  const { state: copyState, copy } = useCopyToClipboard(prompt, {
    selectOnFailure: promptRef,
  });

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <Sparkles className="size-3.5" />
        Edit with your assistant
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <p className="text-muted-foreground text-xs/relaxed">
          Paste this into your coding assistant. It reads the dashboard, makes
          the change, and applies it back.
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
          {copyState === "copied" ? "Copied" : "Copy prompt"}
        </Button>
        <p
          role="status"
          className={cn(
            "mt-2 text-muted-foreground text-xs",
            copyState !== "failed" && "sr-only",
          )}
        >
          {copyState === "copied" && "Prompt copied to clipboard."}
          {copyState === "failed" &&
            "Couldn't access the clipboard. The prompt is selected, copy it manually."}
        </p>
      </PopoverContent>
    </Popover>
  );
}
