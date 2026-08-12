import { Button } from "@everr/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import { cn } from "@everr/ui/lib/utils";
import { Cloud, Laptop } from "lucide-react";
import { useTelemetrySource } from "@/lib/telemetry-source/context";
import type { TelemetrySourceKind } from "@/lib/telemetry-source/types";

/**
 * Which backend dashboard and runbook panels read from. Only rendered when a
 * local collector answered the probe, so the control never offers a source that
 * cannot answer.
 *
 * The popover states which surfaces the toggle affects: in local mode the logs,
 * traces and errors views still read from the cloud, and that mixture is
 * confusing unless it is said out loud.
 */
export function TelemetrySourceToggle() {
  const { kind, setKind, localAvailable, localUnreachable } =
    useTelemetrySource();

  if (!localAvailable && !localUnreachable) return null;

  const isLocal = kind === "local";

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 gap-1.5 px-2 text-xs font-medium",
              isLocal &&
                "bg-sky-500/10 text-sky-300 ring-1 ring-inset ring-sky-500/25 hover:bg-sky-500/20",
            )}
          />
        }
      >
        {isLocal ? (
          <Laptop className="size-3.5 shrink-0" />
        ) : (
          <Cloud className="size-3.5 shrink-0" />
        )}
        <span className="sr-only">Panel data source: </span>
        {isLocal ? "Local" : "Cloud"}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="flex flex-col gap-0.5">
          <SourceOption
            kind="cloud"
            active={kind === "cloud"}
            onSelect={setKind}
            icon={<Cloud className="size-4 shrink-0" />}
            label="Cloud"
            description="Telemetry ingested by Everr."
          />
          <SourceOption
            kind="local"
            active={kind === "local"}
            onSelect={setKind}
            disabled={!localAvailable}
            icon={<Laptop className="size-4 shrink-0" />}
            label="Local"
            description={
              localAvailable
                ? "The collector running on this machine."
                : "No collector is answering on this machine."
            }
          />
        </div>
        <p className="mt-2 border-t pt-2 px-2 text-xs text-muted-foreground">
          Applies to dashboard and runbook panels. Logs, traces and errors
          always read from the cloud.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function SourceOption({
  kind,
  active,
  disabled,
  onSelect,
  icon,
  label,
  description,
}: {
  kind: TelemetrySourceKind;
  active: boolean;
  disabled?: boolean;
  onSelect: (kind: TelemetrySourceKind) => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={() => onSelect(kind)}
      className={cn(
        "flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
        "hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
        active && "bg-accent",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium leading-none">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
