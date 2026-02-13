import { Ban, CheckCircle, CircleDashed, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

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
