import { Spinner } from "@everr/ui/components/spinner";
import { cn } from "@everr/ui/lib/utils";
import { Ban, CheckCircle, CircleDashed, Clock, XCircle } from "lucide-react";

interface ConclusionIconProps {
  conclusion: string;
  className?: string;
}

export function ConclusionIcon({ conclusion, className }: ConclusionIconProps) {
  switch (conclusion) {
    case "success":
      return <CheckCircle className={cn("text-success", className)} />;
    case "failure":
      return <XCircle className={cn("text-destructive", className)} />;
    case "in_progress":
      return <Spinner className={cn("text-warning", className)} />;
    case "queued":
    case "waiting":
    case "requested":
      return <Clock className={cn("text-info", className)} />;
    case "skip":
      return <CircleDashed className={cn("text-muted-foreground", className)} />;
    case "cancellation":
      return <Ban className={cn("text-muted-foreground", className)} />;
    default:
      return <CircleDashed className={cn("text-muted-foreground", className)} />;
  }
}
