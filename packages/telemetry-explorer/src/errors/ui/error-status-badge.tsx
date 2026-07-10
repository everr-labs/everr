import { Badge } from "@everr/ui/components/badge";
import { cn } from "@everr/ui/lib/utils";
import type { ErrorStatus } from "../data/types";
import { ERROR_STATUS_LABELS } from "../data/types";

// Open is the baseline state so it stays quiet; the handled states carry the
// color. Resolved reuses the app's emerald status tone; Ignored reads as
// muted-by-choice (dashed border, muted text) without inventing a new color.
// A Regression (a resolved Error reopened by a newer release) takes the red
// tone from the same family so a failed fix is impossible to miss.
const STATUS_BADGES: Record<
  ErrorStatus | "regressed",
  {
    label: string;
    variant: "outline" | "added" | "removed";
    className?: string;
  }
> = {
  open: { label: ERROR_STATUS_LABELS.open, variant: "outline" },
  resolved: { label: ERROR_STATUS_LABELS.resolved, variant: "added" },
  ignored: {
    label: ERROR_STATUS_LABELS.ignored,
    variant: "outline",
    className: "border-dashed text-muted-foreground",
  },
  regressed: { label: "Regressed", variant: "removed" },
};

export function ErrorStatusBadge({
  status,
  regressed,
  className,
}: {
  status: ErrorStatus;
  regressed?: boolean;
  className?: string;
}) {
  const badge =
    STATUS_BADGES[status === "open" && regressed ? "regressed" : status];
  return (
    <Badge variant={badge.variant} className={cn(badge.className, className)}>
      {badge.label}
    </Badge>
  );
}
