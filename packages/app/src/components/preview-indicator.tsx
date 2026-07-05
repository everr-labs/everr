import { Tooltip, TooltipContent, TooltipTrigger } from "@everr/ui/components/tooltip";
import { GitBranch, LogOut } from "lucide-react";
import { usePreview } from "@/hooks/use-preview";

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
            className="flex h-8 items-center gap-1 rounded-md bg-amber-500/10 pl-2 pr-1 text-xs/relaxed font-medium text-amber-300 ring-1 ring-inset ring-amber-500/25"
          />
        }
      >
        <GitBranch className="size-3.5 shrink-0 text-amber-400" />
        <span className="sr-only">Previewing </span>
        <span className="max-w-[12rem] truncate">{preview}</span>
        <button
          type="button"
          onClick={exitPreview}
          aria-label={`Exit preview "${preview}"`}
          className="ml-0.5 flex size-6 shrink-0 items-center justify-center rounded text-amber-300/80 transition-colors hover:bg-amber-500/20 hover:text-amber-200 focus-visible:outline-2 focus-visible:outline-amber-400/60"
        >
          <LogOut className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Previewing &quot;{preview}&quot; — not live</TooltipContent>
    </Tooltip>
  );
}
