import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import { Toggletip, ToggletipContent, ToggletipTrigger } from "@everr/ui/components/toggletip";
import { AlertCircle, CircleHelp, Info } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { PanelChromeProps } from "./panel-types";
import { TOUCH_TARGET } from "./touch-target";

export interface PanelShellProps extends PanelChromeProps {
  status: "pending" | "error" | "success";
  errorMessage?: string;
  children?: ReactNode;
  style?: CSSProperties;
}

function PanelTitle({ title, description }: { title?: string; description?: string }) {
  return (
    <CardTitle className="flex items-center gap-1.5 text-current/70">
      {title && <span>{title}</span>}
      {description && (
        <Toggletip>
          <ToggletipTrigger
            render={
              <button
                type="button"
                className={cn(
                  "text-muted-foreground hover:text-foreground shrink-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2",
                  TOUCH_TARGET,
                )}
                aria-label={title ? `About ${title}` : "Panel description"}
              />
            }
          >
            <Info className="size-3.5" />
          </ToggletipTrigger>
          <ToggletipContent className="whitespace-pre-wrap">{description}</ToggletipContent>
        </Toggletip>
      )}
    </CardTitle>
  );
}

function StatTitle({ title, titleHint }: { title: string; titleHint?: ReactNode }) {
  if (!titleHint) return <CardDescription>{title}</CardDescription>;
  return (
    <CardDescription className="inline-flex items-center gap-1">
      {title}
      <Toggletip>
        <ToggletipTrigger
          render={
            <button
              type="button"
              className={cn("text-muted-foreground hover:text-foreground", TOUCH_TARGET)}
              aria-label={`What is ${title}?`}
            />
          }
        >
          <CircleHelp className="size-3.5" />
        </ToggletipTrigger>
        <ToggletipContent className="max-w-64">{titleHint}</ToggletipContent>
      </Toggletip>
    </CardDescription>
  );
}

export function PanelShell({
  title,
  titleHint,
  description,
  status,
  errorMessage,
  variant = "default",
  skeleton,
  icon: Icon,
  action,
  inset = "default",
  headerClassName,
  className,
  style,
  children,
}: PanelShellProps) {
  if (variant === "stat") {
    return (
      <Card inset={inset} className={className} style={style}>
        <CardHeader className="relative pb-2">
          <div className="flex items-center justify-between">
            {title && <StatTitle title={title} titleHint={titleHint} />}
            {Icon && <Icon className="text-muted-foreground size-4" />}
          </div>
          {status === "pending" ? (
            <Skeleton className="h-9 w-24" />
          ) : (
            <CardTitle className="animate-reveal text-3xl tabular-nums">
              {status === "error" ? "--" : children}
            </CardTitle>
          )}
        </CardHeader>
      </Card>
    );
  }

  const hasHeader = title || description || action;

  return (
    <Card inset={inset} className={className} style={style}>
      {hasHeader && (
        <CardHeader className={headerClassName}>
          {(title || description) && <PanelTitle title={title} description={description} />}
          {action && <CardAction>{action}</CardAction>}
        </CardHeader>
      )}
      {/* Keyed on readiness so the content remounts, and reveals, exactly once
          when it replaces the skeleton. */}
      <CardContent
        key={status === "pending" ? "pending" : "ready"}
        className={cn("min-h-0 flex-1", status !== "pending" && "animate-reveal")}
      >
        {status === "pending" ? (
          (skeleton ?? <Skeleton className="h-[300px] w-full" />)
        ) : status === "error" ? (
          <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-muted-foreground">
            <AlertCircle className="size-8" />
            <p className="text-sm">Failed to load data</p>
            {errorMessage && (
              <p className="max-w-full truncate px-4 text-xs" title={errorMessage}>
                {errorMessage}
              </p>
            )}
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
