import { Badge } from "@everr/ui/components/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@everr/ui/components/tooltip";
import type { PreviewStatus } from "@/data/previews/overlay";

// Each visible status maps 1:1 to a Badge tone variant (see @everr/ui badge).
// "unchanged" earns no badge, so it's excluded.
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
      <TooltipTrigger render={<Badge variant={status} />}>{LABELS[status]}</TooltipTrigger>
      <TooltipContent>{DESCRIPTIONS[status]}</TooltipContent>
    </Tooltip>
  );
}
