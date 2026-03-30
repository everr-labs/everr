import { cn } from "@everr/ui/lib/utils";
import type { UseQueryResult } from "@tanstack/react-query";
import { useQueries } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PanelShell } from "./panel-shell";
import type { InferQueriesData, PanelChromeProps } from "./panel-types";

export interface DataPanelProps<TQueries extends readonly unknown[]>
  extends PanelChromeProps {
  queries: [...TQueries];
  children: (...data: InferQueriesData<TQueries>) => ReactNode;
  background?: (...data: InferQueriesData<TQueries>) => ReactNode;
}

export function DataPanel<const TQueries extends readonly unknown[]>({
  queries,
  children,
  background,
  variant = "default",
  className,
  ...chromeProps
}: DataPanelProps<TQueries>) {
  // @ts-expect-error -- loose generic constraint preserves element types for inference; queries are valid UseQueryOptions at runtime
  const results: UseQueryResult[] = useQueries({ queries });
  const isPending = results.some((r) => r.isPending);
  const allSuccess = results.every((r) => r.isSuccess);

  if (!allSuccess) {
    return (
      <PanelShell
        {...chromeProps}
        variant={variant}
        className={className}
        status={isPending ? "pending" : "error"}
      />
    );
  }

  const data = results.map((r) => r.data) as InferQueriesData<TQueries>;

  if (variant === "stat" && background) {
    return (
      <PanelShell
        {...chromeProps}
        variant={variant}
        status="success"
        className={cn("relative", className)}
      >
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-15">
          {background(...data)}
        </div>
        <span className="relative">{children(...data)}</span>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      {...chromeProps}
      variant={variant}
      status="success"
      className={className}
    >
      {children(...data)}
    </PanelShell>
  );
}
