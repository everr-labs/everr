import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { AlertCircle, CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import type { PanelChromeProps } from "./panel-types";

export interface PanelShellProps extends PanelChromeProps {
  status: "pending" | "error" | "success";
  children?: ReactNode;
}

function StatTitle({
  title,
  titleHint,
}: {
  title: string;
  titleHint?: ReactNode;
}) {
  if (!titleHint) return <CardDescription>{title}</CardDescription>;
  return (
    <CardDescription className="inline-flex items-center gap-1">
      {title}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              aria-label={`What is ${title}?`}
            />
          }
        >
          <CircleHelp className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{titleHint}</TooltipContent>
      </Tooltip>
    </CardDescription>
  );
}

export function PanelShell({
  title,
  titleHint,
  description,
  status,
  variant = "default",
  skeleton,
  icon: Icon,
  action,
  inset = "default",
  className,
  children,
}: PanelShellProps) {
  if (status === "pending") {
    if (variant === "stat") {
      return (
        <Card inset={inset} className={className}>
          <CardHeader className="pb-1">
            {title && <StatTitle title={title} titleHint={titleHint} />}
            <Skeleton className="h-9 w-24" />
          </CardHeader>
        </Card>
      );
    }
    return (
      <Card inset={inset} className={className}>
        {title !== undefined && (
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
        )}
        <CardContent className={cn(title === undefined && "min-h-0 flex-1")}>
          {skeleton ?? <Skeleton className="h-[300px] w-full" />}
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    if (variant === "stat") {
      return (
        <Card inset={inset} className={className}>
          <CardHeader className="pb-1">
            {title && <StatTitle title={title} titleHint={titleHint} />}
            <CardTitle className="text-3xl tabular-nums">--</CardTitle>
          </CardHeader>
        </Card>
      );
    }
    return (
      <Card inset={inset} className={className}>
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-muted-foreground">
            <AlertCircle className="size-8" />
            <p className="text-sm">Failed to load data</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (variant === "stat") {
    return (
      <Card inset={inset} className={cn(className)}>
        <CardHeader className="relative pb-2">
          <div className="flex items-center justify-between">
            {title && <StatTitle title={title} titleHint={titleHint} />}
            {Icon && <Icon className="text-muted-foreground size-4" />}
          </div>
          <CardTitle className="text-3xl tabular-nums">{children}</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const hasHeader = title || description || action;

  return (
    <Card inset={inset} className={cn(className)}>
      {hasHeader && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
          {action && <CardAction>{action}</CardAction>}
        </CardHeader>
      )}
      <CardContent className={cn(!hasHeader && "min-h-0 flex-1")}>
        {children}
      </CardContent>
    </Card>
  );
}
