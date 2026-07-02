import { Badge } from "@everr/ui/components/badge";
import type { PreviewStatus } from "@/data/previews/overlay";

// Diff vocabulary for the preview overlay, tuned for the app's dark surfaces:
// a saturated 400-shade sits legibly on the near-black content and sidebar,
// where the Tailwind 600 shades the sketch reached for would read as mud.
// "unchanged" is intentionally absent — it earns no badge.
const STYLES: Record<Exclude<PreviewStatus, "unchanged">, string> = {
  added: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  changed: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  removed: "border-red-500/40 bg-red-500/10 text-red-400",
};

const LABELS: Record<Exclude<PreviewStatus, "unchanged">, string> = {
  added: "Added",
  changed: "Changed",
  removed: "Removed",
};

/**
 * A compact diff pill for a resource under an active preview. Renders nothing
 * for the two non-events — no preview status, or unchanged — so callers can
 * drop it in unconditionally next to a resource name.
 */
export function PreviewStatusBadge({ status }: { status?: PreviewStatus }) {
  if (!status || status === "unchanged") return null;
  return (
    <Badge variant="outline" className={STYLES[status]}>
      {LABELS[status]}
    </Badge>
  );
}
