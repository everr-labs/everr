import { cn } from "@everr/ui/lib/utils";
import {
  Ban,
  CheckCircle,
  CircleDashed,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";

interface ConclusionIconProps {
  conclusion: string;
  className?: string;
}

export function ConclusionIcon({ conclusion, className }: ConclusionIconProps) {
  switch (conclusion) {
    case "success":
      return <CheckCircle className={cn("text-green-600", className)} />;
    case "failure":
      return <XCircle className={cn("text-red-600", className)} />;
    case "in_progress":
      return (
        <Loader2 className={cn("text-yellow-500 animate-spin", className)} />
      );
    case "queued":
    case "waiting":
    case "requested":
      return <Clock className={cn("text-blue-500", className)} />;
    case "skip":
      return (
        <CircleDashed className={cn("text-muted-foreground", className)} />
      );
    case "cancellation":
      return <Ban className={cn("text-muted-foreground", className)} />;
    default:
      return (
        <CircleDashed className={cn("text-muted-foreground", className)} />
      );
  }
}
