import { Button } from "@everr/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { cn } from "@everr/ui/lib/utils";
import { useIsFetching } from "@tanstack/react-query";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { REFRESH_INTERVALS } from "@/lib/time-range";

export function RefreshPicker() {
  const { refreshInterval, setRefreshInterval, refreshNow } = useAutoRefresh();
  const isFetching = useIsFetching();
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    if (isFetching > 0) {
      setSpinning(true);
    }
  }, [isFetching]);

  const handleAnimationIteration = useCallback(() => {
    if (isFetching === 0) {
      setSpinning(false);
    }
  }, [isFetching]);

  const activeLabel =
    REFRESH_INTERVALS.find((i) => i.value === refreshInterval)?.label ?? "Off";

  return (
    <div className="flex items-center">
      <Button
        variant="outline"
        size="lg"
        className="rounded-r-none border-r-0"
        onClick={refreshNow}
      >
        <RefreshCwIcon
          className={cn(
            "size-3.5 linear ",
            spinning && "animate-[spin_600ms_ease_infinite]",
          )}
          onAnimationIteration={handleAnimationIteration}
        />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="lg"
              className="rounded-l-none gap-1 px-1.5"
            />
          }
        >
          {refreshInterval && (
            <span className="text-xs text-center">{activeLabel}</span>
          )}
          <ChevronDownIcon className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {REFRESH_INTERVALS.map((interval) => {
            const isActive = interval.value === refreshInterval;
            return (
              <DropdownMenuItem
                key={interval.value}
                className={cn(isActive && "font-medium text-primary")}
                onClick={() => setRefreshInterval(interval.value)}
              >
                {interval.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
