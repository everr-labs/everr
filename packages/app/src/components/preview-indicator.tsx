import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { GitBranch, LogOut } from "lucide-react";

/**
 * "You're not on live" marker for the global header. Reads the active preview
 * straight off the `?preview=` search param — the URL is the only source of
 * truth now that the CLI deep link, not a switcher, sets the context — so it
 * appears on every page under the dashboard layout whenever a preview is active.
 *
 * Persistent exit affordance: unlike the per-page banner (which can be
 * dismissed), this header pill always offers a way out of preview mode. It wears
 * the same amber "not live" hue as the diff badges and banner so the mode reads
 * at a glance, and uses the banner's `LogOut` glyph for exit (the banner keeps
 * `X` for its separate dismiss action, so the two never read as the same thing).
 */
export function PreviewIndicator() {
  const navigate = useNavigate();
  const { preview: raw } = useSearch({ from: "/_authenticated/_dashboard" });
  // Reads treat "" / whitespace as live; mirror that here so a stray `?preview=`
  // doesn't light up an empty amber pill.
  const preview = raw?.trim();
  if (!preview) return null;

  const exitPreview = () =>
    navigate({ to: ".", search: (prev) => ({ ...prev, preview: undefined }) });

  return (
    <Tooltip>
      {/* Render the trigger as the pill itself (a div, not the default button)
          so the exit button can nest inside it without invalid button-in-button
          markup, and hovering anywhere on the pill surfaces the tooltip. */}
      <TooltipTrigger
        render={
          <div
            role="status"
            // Match the header's outline buttons (CommandBar, time-range/refresh
            // pickers): h-8, rounded-md, text-xs/relaxed — so the pill shares
            // their vertical rhythm and only the amber tone sets it apart. Right
            // padding is trimmed (pr-1) so the exit button hugs the edge without
            // growing the pill.
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
      <TooltipContent>Previewing "{preview}" — not live</TooltipContent>
    </Tooltip>
  );
}
