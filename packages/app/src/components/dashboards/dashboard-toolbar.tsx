import type { ReactNode } from "react";
import { FrameToggle } from "#app/components/rail/frame-toggle.tsx";
import { useHasVisibleVariables, VariableBar } from "./variable-bar";

/**
 * The control row above a dashboard's content: the rail frame toggle, the
 * variable bar, and optional page actions. Shared by the grid page and a
 * panel's full-screen page so both keep the same controls at the same spot —
 * moving between them never moves the variables you are adjusting.
 */
export function DashboardToolbar({
  actions,
  /** Off where the grid is not seated next to a rail (the home page). */
  frameToggle = true,
}: {
  actions?: ReactNode;
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
