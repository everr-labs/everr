import { Badge } from "@everr/ui/components/badge";
import { cn } from "@everr/ui/lib/utils";
import type { ErrorStatus } from "../data/types";
import { ERROR_STATUS_LABELS } from "../data/types";

// Open is the baseline state so it stays quiet; the handled states carry the
// color. Resolved reuses the app's emerald status tone; Ignored reads as
// muted-by-choice (dashed border, muted text) without inventing a new color.
const STATUS_BADGES: Record<
  ErrorStatus,
  { variant: "outline" | "added"; className?: string }
> = {
  open: { variant: "outline" },
  resolved: { variant: "added" },
  ignored: {
    variant: "outline",
    className: "border-dashed text-muted-foreground",
  },
};

export function ErrorStatusBadge({
  status,
  className,
}: {
  status: ErrorStatus;
  className?: string;
}) {
  const badge = STATUS_BADGES[status];
  return (
    <Badge variant={badge.variant} className={cn(badge.className, className)}>
      {ERROR_STATUS_LABELS[status]}
    </Badge>
  );
}
