import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { cva } from "@everr/ui/lib/cva";

interface ConclusionIconProps {
  conclusion: string;
  className?: string;
}

const conclusionIconStyles = cva(
  "flex items-center justify-center rounded-full size-3 [&::before]:content-[''] [&::before]:size-1 [&::before]:rounded-full [&::before]:block",
  {
    variants: {
      conclusion: {
        success: "bg-green-500/20 [&::before]:bg-green-600",
        failure: "bg-red-500/20 [&::before]:bg-red-600",
        in_progress:
          "bg-primary/20 [&::before]:bg-primary [&::before]:animation-pulse",
        queued: "bg-blue-500/20 [&::before]:bg-blue-500",
        waiting: "bg-blue-500/20 [&::before]:bg-blue-500",
        requested: "bg-blue-500/20 [&::before]:bg-blue-500",
        skip: "bg-muted-foreground/20 [&::before]:bg-muted-foreground",
        cancellation: "bg-muted-foreground/20 [&::before]:bg-muted-foreground",
        unknown: "bg-muted-foreground/20 [&::before]:bg-muted-foreground",
      },
    },
    defaultVariants: {
      conclusion: "success",
    },
  },
);

export function ConclusionIcon({ conclusion, className }: ConclusionIconProps) {
  switch (conclusion) {
    case "success":
    case "failure":
    case "in_progress":
    case "skip":
    case "queued":
    case "waiting":
    case "requested":
    case "cancellation":
      return (
        <Tooltip>
          <TooltipTrigger
            delay={100}
            render={
              <div
                className={conclusionIconStyles({ conclusion, className })}
              />
            }
          />
          <TooltipContent>Success</TooltipContent>
        </Tooltip>
      );

    default:
      return (
        <Tooltip>
          <TooltipTrigger
            delay={100}
            render={
              <div
                className={conclusionIconStyles({
                  conclusion: "unknown",
                  className,
                })}
              />
            }
          />
          <TooltipContent>Success</TooltipContent>
        </Tooltip>
      );
  }
}
