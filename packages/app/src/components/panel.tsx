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
import type { UseQueryResult } from "@tanstack/react-query";
import { useQueries } from "@tanstack/react-query";
import { AlertCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import { useTimeRange } from "@/hooks/use-time-range";

type ExtractQueryFn<T> = T extends { queryFn?: infer QF }
  ? Extract<QF, (...args: never[]) => unknown>
  : never;

type ExtractQueryData<T> =
  ExtractQueryFn<T> extends (...args: never[]) => infer R
    ? Awaited<R>
    : unknown;

type InferFactoryData<T> = T extends (...args: never[]) => infer R
  ? ExtractQueryData<R>
  : unknown;

type InferQueriesData<T extends readonly unknown[]> = {
  [K in keyof T]: InferFactoryData<T[K]>;
};

type QueryFactory = (input: TimeRangeInput) => unknown;

interface PanelProps<TQueries extends readonly QueryFactory[]> {
  title: string;
  description?: string;
  queries: [...TQueries];
  children: (...data: InferQueriesData<TQueries>) => ReactNode;
  background?: (...data: InferQueriesData<TQueries>) => ReactNode;
  variant?: "default" | "stat";
  skeleton?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  inset?: "default" | "flush-content";
  className?: string;
}

export function Panel<const TQueries extends readonly QueryFactory[]>({
  title,
  description,
  queries: queryFactories,
  children,
  background,
  variant = "default",
  skeleton,
  icon: Icon,
  action,
  inset = "default",
  className,
}: PanelProps<TQueries>) {
  const { timeRange } = useTimeRange();
  const resolvedQueries = queryFactories.map((factory) =>
    factory({ timeRange }),
  );
  // @ts-expect-error -- loose generic constraint preserves element types for inference; queries are valid UseQueryOptions at runtime
  const results: UseQueryResult[] = useQueries({ queries: resolvedQueries });
  const isPending = results.some((r) => r.isPending);
  const error = results.find((r) => r.isError)?.error;
  const allReady = results.every((r) => r.data !== undefined);

  if (isPending) {
    if (variant === "stat") {
      return (
        <Card inset={inset} className={className}>
          <CardHeader className="pb-1">
            <CardDescription>{title}</CardDescription>
            <Skeleton className="h-9 w-24" />
          </CardHeader>
        </Card>
      );
    }
    return (
      <Card inset={inset} className={className}>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          {skeleton ?? <Skeleton className="h-[300px] w-full" />}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    if (variant === "stat") {
      return (
        <Card inset={inset} className={className}>
          <CardHeader className="pb-1">
            <CardDescription>{title}</CardDescription>
            <CardTitle className="text-3xl tabular-nums">--</CardTitle>
          </CardHeader>
        </Card>
      );
    }
    return (
      <Card inset={inset} className={className}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
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

  if (!allReady) return null;

  const data = results.map((r) => r.data) as InferQueriesData<TQueries>;

  if (variant === "stat") {
    return (
      <Card inset={inset} className={cn(background && "relative", className)}>
        {background && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-15">
            {background(...data)}
          </div>
        )}
        <CardHeader className="relative pb-2">
          <div className="flex items-center justify-between">
            <CardDescription>{title}</CardDescription>
            {Icon && <Icon className="text-muted-foreground size-4" />}
          </div>
          <CardTitle className="text-3xl tabular-nums">
            {children(...data)}
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card inset={inset} className={cn(className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>{children(...data)}</CardContent>
    </Card>
  );
}
