import type { ReactNode } from "react";
import { FrameToggle } from "#app/components/rail/frame-toggle.tsx";
import { useHasVisibleVariables, VariableBar } from "./variable-bar";

/**
 * The control row above a dashboard's panels: the rail toggle, the variable
 * pickers, then the page's own actions. Shared by the grid and the maximized
 * panel so the two pages keep the same controls in the same place.
 */
export function DashboardToolbar({
  actions,
  frameToggle = true,
}: {
  actions?: ReactNode;
  /** Off where the page is not seated next to a rail (the home page). */
  frameToggle?: boolean;
}) {
  const hasVariables = useHasVisibleVariables();
  return (
    <div className="mb-3 flex items-start gap-x-3">
      {frameToggle && (
        <div className="flex h-8 shrink-0 items-center">
          <FrameToggle />
        </div>
      )}
      {frameToggle && hasVariables && (
        <div aria-hidden className="flex h-8 items-center">
          <div className="h-5 w-px bg-border" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <VariableBar layout="inline" />
      </div>
      {actions && <div className="ml-auto flex h-8 shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
