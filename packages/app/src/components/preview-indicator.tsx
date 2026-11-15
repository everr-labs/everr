/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Preserve the existing status element and layout during the linter migration. */
import { Tooltip, TooltipContent, TooltipTrigger } from "@everr/ui/components/tooltip";
import { GitBranch, LogOut } from "lucide-react";
import { usePreview } from "#app/hooks/use-preview.ts";

// "Not on live" marker in the global header, driven by the `?preview=` param.
// Unlike the dismissible banner, it always offers a way out of preview mode.
export function PreviewIndicator() {
  const { name: preview, exit: exitPreview } = usePreview();
  if (!preview) return null;

  return (
    <Tooltip>
      {/* Trigger renders as the pill div (not the default button) so the exit
          button can nest inside without button-in-button markup. */}
      <TooltipTrigger
        render={
          <div
            role="status"
            className="flex h-8 items-center gap-1 rounded-md bg-warning/10 pl-2 pr-1 text-xs/relaxed font-medium text-warning ring-1 ring-inset ring-warning/25"
          />
        }
      >
        <GitBranch className="size-3.5 shrink-0 text-warning" />
        <span className="sr-only">Previewing </span>
        <span className="max-w-[12rem] truncate max-sm:max-w-20">{preview}</span>
        <button
          type="button"
          onClick={exitPreview}
          aria-label={`Exit preview "${preview}"`}
          className="ml-0.5 flex size-6 shrink-0 items-center justify-center rounded text-warning/75 transition-colors hover:bg-warning/20 hover:text-warning focus-visible:outline-2 focus-visible:outline-warning/60"
        >
          <LogOut className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Previewing &quot;{preview}&quot; — not live</TooltipContent>
    </Tooltip>
  );
}
