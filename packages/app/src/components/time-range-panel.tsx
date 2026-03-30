import type { ReactNode } from "react";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import { useTimeRange } from "@/hooks/use-time-range";
import { DataPanel } from "./data-panel";
import type { InferFactoriesData, PanelChromeProps } from "./panel-types";

type QueryFactory = (input: TimeRangeInput) => unknown;

interface TimeRangePanelProps<TQueries extends readonly QueryFactory[]>
  extends PanelChromeProps {
  queries: [...TQueries];
  children: (...data: InferFactoriesData<TQueries>) => ReactNode;
  background?: (...data: InferFactoriesData<TQueries>) => ReactNode;
}

export function TimeRangePanel<const TQueries extends readonly QueryFactory[]>({
  queries: queryFactories,
  ...rest
}: TimeRangePanelProps<TQueries>) {
  const { timeRange } = useTimeRange();
  const resolvedQueries = queryFactories.map((factory) =>
    factory({ timeRange }),
  );

  return (
    // @ts-expect-error -- resolved queries lose their generic mapping through .map(); data types are preserved via InferFactoriesData at the call site
    <DataPanel queries={resolvedQueries} {...rest} />
  );
}
