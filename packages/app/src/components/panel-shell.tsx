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
import { AlertCircle, CircleHelp, Info } from "lucide-react";
import type { ReactNode } from "react";
import type { PanelChromeProps } from "./panel-types";

export interface PanelShellProps extends PanelChromeProps {
  status: "pending" | "error" | "success";
  errorMessage?: string;
  children?: ReactNode;
}

function PanelTitle({
  title,
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <CardTitle className="flex items-center gap-1.5">
      {title && <span>{title}</span>}
      {description && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground shrink-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                aria-label={title ? `About ${title}` : "Panel description"}
              />
            }
          >
            <Info className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent className="max-w-80 whitespace-pre-wrap">
            {description}
          </TooltipContent>
        </Tooltip>
      )}
    </CardTitle>
  );
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
  errorMessage,
  variant = "default",
  skeleton,
  icon: Icon,
  action,
  inset = "default",
  headerClassName,
  className,
  children,
}: PanelShellProps) {
  if (variant === "stat") {
    return (
      <Card inset={inset} className={className}>
        <CardHeader className="relative pb-2">
          <div className="flex items-center justify-between">
            {title && <StatTitle title={title} titleHint={titleHint} />}
            {Icon && <Icon className="text-muted-foreground size-4" />}
          </div>
          {status === "pending" ? (
            <Skeleton className="h-9 w-24" />
          ) : (
            <CardTitle className="text-3xl tabular-nums">
              {status === "error" ? "--" : children}
            </CardTitle>
          )}
        </CardHeader>
      </Card>
    );
  }

  const hasHeader = title || description || action;

  return (
    <Card inset={inset} className={className}>
      {hasHeader && (
        <CardHeader className={headerClassName}>
          {(title || description) && (
            <PanelTitle title={title} description={description} />
          )}
          {action && <CardAction>{action}</CardAction>}
        </CardHeader>
      )}
      <CardContent className="min-h-0 flex-1">
        {status === "pending" ? (
          (skeleton ?? <Skeleton className="h-[300px] w-full" />)
        ) : status === "error" ? (
          <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-muted-foreground">
            <AlertCircle className="size-8" />
            <p className="text-sm">Failed to load data</p>
            {errorMessage && (
              <p
                className="max-w-full truncate px-4 text-xs"
                title={errorMessage}
              >
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
