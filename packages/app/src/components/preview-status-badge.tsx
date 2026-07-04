import { Badge } from "@everr/ui/components/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import type { PreviewStatus } from "@/data/previews/overlay";

// 400-shades read legibly on the app's near-black surfaces. "unchanged" earns
// no badge, so it's excluded.
const STYLES: Record<Exclude<PreviewStatus, "unchanged">, string> = {
  added: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  changed: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  conflict: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-400",
  removed: "border-red-500/40 bg-red-500/10 text-red-400",
};

const LABELS: Record<Exclude<PreviewStatus, "unchanged">, string> = {
  added: "Added",
  changed: "Changed",
  conflict: "Conflict",
  removed: "Removed",
};

// Why the badge is shown, surfaced on hover/focus. "conflict" is the load-
// bearing one: the label alone doesn't explain the cross-repo ownership clash
// or how to resolve it.
const DESCRIPTIONS: Record<Exclude<PreviewStatus, "unchanged">, string> = {
  added: "New in this preview — there's no live version yet.",
  changed: "This preview differs from the live version.",
  conflict:
    "Its name (project/slug) is already owned by another repo. Applying it " +
    "live would fail unless you re-run apply with --adopt to transfer ownership.",
  removed: "Deleted in this preview — you're viewing the live version.",
};

// Renders nothing without a status (or when unchanged), so callers can drop it
// in unconditionally. The badge is its own tooltip trigger, explaining why the
// resource carries this status — the "conflict" case especially.
export function PreviewStatusBadge({ status }: { status?: PreviewStatus }) {
  if (!status || status === "unchanged") return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Badge variant="outline" className={STYLES[status]} />}
      >
        {LABELS[status]}
      </TooltipTrigger>
      <TooltipContent>{DESCRIPTIONS[status]}</TooltipContent>
    </Tooltip>
  );
}
