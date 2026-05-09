import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import { Separator } from "@everr/ui/components/separator";
import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import { cn } from "@everr/ui/lib/utils";
import { Hash, ListFilter, X } from "lucide-react";
import { useState } from "react";
import {
  logRepoFilterOptions,
  logServiceFilterOptions,
} from "../data/options";
import type { LogLevel } from "../schemas";
import type { TimeRange } from "../time-range";
import type { LogsRepositoryLike } from "../data/repository";
import { LOG_LEVEL_META, LOG_LEVELS } from "./log-level-meta";

export interface LogFiltersBarProps {
  repo: LogsRepositoryLike;
  timeRange: TimeRange;
  levels: LogLevel[];
  services: string[];
  repos: string[];
  traceId: string | undefined;
  levelCounts?: Record<LogLevel, number>;
  onChange: (patch: {
    levels?: LogLevel[];
    services?: string[];
    repos?: string[];
    traceId?: string;
  }) => void;
}

function levelDotClassName(level: LogLevel) {
  return LOG_LEVEL_META[level].dotClassName;
}

function TraceFilter({
  traceId,
  onChange,
}: {
  traceId?: string;
  onChange: (traceId?: string) => void;
}) {
  const [value, setValue] = useState(traceId ?? "");

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        onChange(trimmed || undefined);
      }}
    >
      <label htmlFor="logs-trace-id" className="text-muted-foreground text-xs">
        Trace
      </label>
      <InputGroup className="h-8">
        <InputGroupAddon>
          <Hash />
        </InputGroupAddon>
        <InputGroupInput
          id="logs-trace-id"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Any trace"
        />
        {traceId ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear trace"
              onClick={() => {
                setValue("");
                onChange(undefined);
              }}
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </form>
  );
}

export function LogFiltersBar({
  repo,
  timeRange,
  levels,
  services,
  repos,
  traceId,
  levelCounts,
  onChange,
}: LogFiltersBarProps) {
  const toggleLevel = (level: LogLevel) => {
    const nextLevels = levels.includes(level)
      ? levels.filter((item) => item !== level)
      : [...levels, level];
    onChange({ levels: nextLevels });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <ListFilter className="text-muted-foreground size-3.5" />
        Filter
      </div>

      <div className="space-y-1">
        {LOG_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={cn(
              "flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-xs transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              levels.includes(level) &&
                "bg-background font-medium shadow-xs ring-1 ring-border",
            )}
            onClick={() => toggleLevel(level)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "size-2 rounded-full",
                  levelDotClassName(level),
                )}
              />
              <span className="truncate capitalize">{level}</span>
            </span>
            <span className="text-muted-foreground font-mono tabular-nums">
              {levelCounts ? levelCounts[level].toLocaleString() : "—"}
            </span>
          </button>
        ))}
      </div>

      <Separator />

      <FilterCombobox
        label="Service"
        values={services}
        onChange={(nextServices) => onChange({ services: nextServices })}
        options={logServiceFilterOptions(repo, { timeRange })}
        placeholder="All services"
        searchPlaceholder="Search services..."
        className="w-full"
      />
      <FilterCombobox
        label="Source"
        values={repos}
        onChange={(nextRepos) => onChange({ repos: nextRepos })}
        options={logRepoFilterOptions(repo, { timeRange })}
        placeholder="All sources"
        searchPlaceholder="Search sources..."
        className="w-full"
      />
      <TraceFilter
        traceId={traceId}
        onChange={(nextTraceId) => onChange({ traceId: nextTraceId })}
      />
    </div>
  );
}
