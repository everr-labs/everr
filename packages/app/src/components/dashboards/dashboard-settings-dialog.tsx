import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { Label } from "@everr/ui/components/label";
import { REFRESH_INTERVALS } from "@everr/ui/components/refresh-picker";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

const DURATION_OPTIONS = [
  { label: "Default (last 7 days)", value: "" },
  { label: "Last 5 minutes", value: "5m" },
  { label: "Last 15 minutes", value: "15m" },
  { label: "Last 30 minutes", value: "30m" },
  { label: "Last 1 hour", value: "1h" },
  { label: "Last 3 hours", value: "3h" },
  { label: "Last 6 hours", value: "6h" },
  { label: "Last 12 hours", value: "12h" },
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 2 days", value: "2d" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
] as const;

function OptionSelect({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: ReadonlyArray<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  const active = options.find((o) => o.value === value) ?? options[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            id={id}
            variant="outline"
            className="w-full justify-between font-normal"
          />
        }
      >
        {active.label}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface DashboardSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDuration?: string;
  initialRefreshInterval?: string;
  isPending?: boolean;
  onConfirm: (settings: {
    duration?: string;
    refreshInterval?: string;
  }) => void;
}

export function DashboardSettingsDialog({
  open,
  onOpenChange,
  initialDuration,
  initialRefreshInterval,
  isPending,
  onConfirm,
}: DashboardSettingsDialogProps) {
  const [duration, setDuration] = useState(initialDuration ?? "");
  const [refreshInterval, setRefreshInterval] = useState(
    initialRefreshInterval ?? "",
  );

  useEffect(() => {
    if (open) {
      setDuration(initialDuration ?? "");
      setRefreshInterval(initialRefreshInterval ?? "");
    }
  }, [open, initialDuration, initialRefreshInterval]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dashboard settings</DialogTitle>
          <DialogDescription>
            Defaults applied when the dashboard is opened without an explicit
            time range or refresh interval in the URL.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="dashboard-duration">Default time range</Label>
          <OptionSelect
            id="dashboard-duration"
            options={DURATION_OPTIONS}
            value={duration}
            onChange={setDuration}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="dashboard-refresh">Auto-refresh</Label>
          <OptionSelect
            id="dashboard-refresh"
            options={REFRESH_INTERVALS.map((i) => ({
              label: i.label,
              value: i.value,
            }))}
            value={refreshInterval}
            onChange={setRefreshInterval}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isPending}
            onClick={() =>
              onConfirm({
                duration: duration || undefined,
                refreshInterval: refreshInterval || undefined,
              })
            }
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
