import { CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConclusionIconProps {
  conclusion: string;
  className?: string;
}

export function ConclusionIcon({ conclusion, className }: ConclusionIconProps) {
  switch (conclusion) {
    case "failure":
      return <XCircle className={cn("text-red-600", className)} />;
    default:
      return <CheckCircle className={cn("text-green-600", className)} />;
  }
}
