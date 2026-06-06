import { Button } from "@everr/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { Label } from "@everr/ui/components/label";
import { REFRESH_INTERVALS } from "@everr/ui/components/refresh-picker";
import { ChevronDown } from "lucide-react";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";

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

export function SettingsGeneralSection() {
  const dashboard = useDashboardStore((s) => s.dashboard);
  const patchDashboard = useDashboardStore((s) => s.patchDashboard);

  if (!dashboard) return null;

  return (
    <div className="flex w-full max-w-md flex-col gap-4 p-4">
      <p className="text-sm text-muted-foreground">
        Defaults applied when the dashboard is opened without an explicit time
        range or refresh interval in the URL.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="dashboard-duration">Default time range</Label>
        <OptionSelect
          id="dashboard-duration"
          options={DURATION_OPTIONS}
          value={dashboard.spec.duration ?? ""}
          onChange={(value) =>
            patchDashboard({
              ...dashboard,
              spec: { ...dashboard.spec, duration: value || undefined },
            })
          }
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
          value={dashboard.spec.refreshInterval ?? ""}
          onChange={(value) =>
            patchDashboard({
              ...dashboard,
              spec: { ...dashboard.spec, refreshInterval: value || undefined },
            })
          }
        />
      </div>
    </div>
  );
}
