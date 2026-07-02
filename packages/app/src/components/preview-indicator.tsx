import { useSearch } from "@tanstack/react-router";
import { GitBranch } from "lucide-react";

/**
 * Passive "you're not on live" marker for the global header. Reads the active
 * preview straight off the `?preview=` search param — the URL is the only source
 * of truth now that the CLI deep link, not a switcher, sets the context — so it
 * appears on every page under the dashboard layout whenever a preview is active.
 *
 * Deliberately inert: no click target, no exit. Exiting a preview lives on the
 * per-page banner; this is only the ambient reminder. Wears the same amber
 * "not live" hue as the diff badges and banner so the mode reads at a glance.
 */
export function PreviewIndicator() {
  const { preview: raw } = useSearch({ from: "/_authenticated/_dashboard" });
  // Reads treat "" / whitespace as live; mirror that here so a stray `?preview=`
  // doesn't light up an empty amber pill.
  const preview = raw?.trim();
  if (!preview) return null;
  return (
    <div
      role="status"
      title={`Previewing "${preview}" — not live`}
      className="flex h-6 items-center gap-1.5 rounded-md bg-amber-500/10 px-2 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-500/25"
    >
      <GitBranch className="size-3.5 shrink-0 text-amber-400" />
      <span className="sr-only">Previewing </span>
      <span className="max-w-[12rem] truncate">{preview}</span>
    </div>
  );
}
