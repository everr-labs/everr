import { Button } from "@everr/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@everr/ui/components/popover";
import { SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { FrameToggle } from "#app/components/rail/frame-toggle.tsx";
import { useHasVisibleVariables, VariableBar } from "./variable-bar";

/**
 * The control row above a dashboard's panels: the rail toggle, the variable
 * pickers, then the page's own actions. Shared by the grid and the maximized
 * panel so the two pages keep the same controls in the same place.
 *
 * Below `sm` the pickers fold into a Filters popover: inline they would wrap
 * into rows that push the first panel off a phone screen.
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
      {frameToggle && <FrameToggle />}
      {frameToggle && hasVariables && (
        <div aria-hidden className="flex h-8 items-center">
          <div className="h-5 w-px bg-border" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="max-sm:hidden">
          <VariableBar layout="inline" />
        </div>
        {hasVariables && (
          <div className="sm:hidden">
            <Popover>
              <PopoverTrigger render={<Button variant="outline" size="sm" className="h-8" />}>
                <SlidersHorizontal className="size-3.5" />
                Filters
              </PopoverTrigger>
              <PopoverContent
                align="start"
                collisionPadding={12}
                className="w-[calc(100vw-1.5rem)] max-h-(--available-height) overflow-y-auto *:mb-0"
              >
                <VariableBar />
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
      {actions && <div className="ml-auto flex h-8 shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
