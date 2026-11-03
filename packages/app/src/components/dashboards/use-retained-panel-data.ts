import { useState } from "react";
import type { Panel } from "#app/data/dashboards/schema.ts";
import type { DashboardPanelData } from "./use-dashboard-panel-data";

function sameResult(a: DashboardPanelData, b: DashboardPanelData): boolean {
  return (
    a.timeRange.from.getTime() === b.timeRange.from.getTime() &&
    a.timeRange.to.getTime() === b.timeRange.to.getTime() &&
    (a.data === b.data ||
      (a.data !== undefined &&
        b.data !== undefined &&
        a.data.length === b.data.length &&
        a.data.every((rows, index) => rows === b.data?.[index])))
  );
}

/** Keep the last committed complete result and its range while a batch loads. */
export function useRetainedPanelData(
  panel: Panel,
  current: DashboardPanelData,
): DashboardPanelData {
  const [lastComplete, setLastComplete] = useState<{
    panel: Panel;
    result: DashboardPanelData;
  } | null>(() => (current.status === "success" ? { panel, result: current } : null));

  if (current.status === "success") {
    // Adjust state during this render so React can discard it with an
    // interrupted render. The query result's outer array may be recreated,
    // so compare the individual frames rather than the array itself.
    if (lastComplete?.panel !== panel || !sameResult(lastComplete.result, current)) {
      setLastComplete({ panel, result: current });
    }
    return current;
  }

  return current.status === "pending" && lastComplete?.panel === panel
    ? lastComplete.result
    : current;
}
