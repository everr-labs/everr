import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export interface RefreshInterval {
  label: string;
  value: string;
  ms?: number;
}

export const REFRESH_INTERVALS: readonly RefreshInterval[] = [
  { label: "Off", value: "" },
  { label: "5s", value: "5s", ms: 5_000 },
  { label: "10s", value: "10s", ms: 10_000 },
  { label: "30s", value: "30s", ms: 30_000 },
  { label: "1m", value: "1m", ms: 60_000 },
  { label: "5m", value: "5m", ms: 300_000 },
] as const;

export function getRefreshIntervalMs(value: string): number | null {
  const interval = REFRESH_INTERVALS.find((i) => i.value === value);
  return interval && "ms" in interval && interval.ms ? interval.ms : null;
}

export function RefreshPicker({
  value,
  onChange,
  onRefresh,
  isFetching,
}: {
  value: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
  isFetching: boolean;
}) {
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    if (isFetching) {
      setSpinning(true);
    }
  }, [isFetching]);

  const handleAnimationIteration = useCallback(() => {
    if (!isFetching) {
      setSpinning(false);
    }
  }, [isFetching]);

  const activeLabel =
    REFRESH_INTERVALS.find((i) => i.value === value)?.label ?? "Off";

  return (
    <div className="flex items-center">
      <Button
        variant="outline"
        className="rounded-r-none border-r-0"
        onClick={onRefresh}
      >
        <RefreshCwIcon
          className={cn(
            "size-3.5 linear",
            spinning && "animate-[spin_600ms_ease_infinite]",
          )}
          onAnimationIteration={handleAnimationIteration}
        />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" className="rounded-l-none gap-1 px-1.5" />
          }
        >
          {value && <span className="text-xs text-center">{activeLabel}</span>}
          <ChevronDownIcon className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {REFRESH_INTERVALS.map((interval) => {
            const isActive = interval.value === value;
            return (
              <DropdownMenuItem
                key={interval.value}
                className={cn(isActive && "font-medium text-primary")}
                onClick={() => onChange(interval.value)}
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
