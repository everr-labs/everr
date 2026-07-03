import { Badge } from "@everr/ui/components/badge";
import type { PreviewStatus } from "@/data/previews/overlay";

// 400-shades read legibly on the app's near-black surfaces. "unchanged" earns
// no badge, so it's excluded.
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

// Renders nothing without a status (or when unchanged), so callers can drop it
// in unconditionally.
export function PreviewStatusBadge({ status }: { status?: PreviewStatus }) {
  if (!status || status === "unchanged") return null;
  return (
    <Badge variant="outline" className={STYLES[status]}>
      {LABELS[status]}
    </Badge>
  );
}
