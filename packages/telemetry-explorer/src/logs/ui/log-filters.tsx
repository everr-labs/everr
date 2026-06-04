import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import { Separator } from "@everr/ui/components/separator";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { Hash, X } from "lucide-react";
import { useState } from "react";
import { DedicatedAttributeSection } from "../../filters/ui/dedicated-attribute-section";
import { ENVIRONMENT_ATTRIBUTE } from "../../filters/ui/dedicated-attributes";
import { EnvironmentFilter } from "../../filters/ui/environment-filter";
import { FilterSidebar } from "../../filters/ui/filter-sidebar";
import { logServiceFilterOptions } from "../data/options";
import type { LogsRepositoryLike } from "../data/repository";
import type { AttributeFilter, LogLevel } from "../schemas";
import {
  LOGS_ATTRIBUTE_SOURCES_UI,
  LOGS_EXCLUDED_KEYS,
  LOGS_PROMOTED_ATTRIBUTES,
} from "./log-attribute-config";
import { LOG_LEVEL_META, LOG_LEVELS } from "./log-level-meta";

export interface LogFiltersBarProps {
  repo: LogsRepositoryLike;
  timeRange: TimeRange;
  levels: LogLevel[];
  services: string[];
  attributes: AttributeFilter[];
  traceId: string | undefined;
  levelCounts?: Record<LogLevel, number>;
  onChange: (patch: {
    levels?: LogLevel[];
    services?: string[];
    attributes?: AttributeFilter[];
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
  attributes,
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

  const hasActiveFilters =
    levels.length > 0 ||
    services.length > 0 ||
    attributes.length > 0 ||
    traceId !== undefined;

  return (
    <FilterSidebar
      label="Log filters"
      hasActiveFilters={hasActiveFilters}
      onClear={() =>
        onChange({
          levels: [],
          services: [],
          attributes: [],
          traceId: undefined,
        })
      }
    >
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
                className={cn("size-2 rounded-full", levelDotClassName(level))}
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

      <EnvironmentFilter
        repo={repo}
        domain="logs"
        timeRange={timeRange}
        attributes={attributes}
        onChange={(next) => onChange({ attributes: next })}
      />

      <Separator />

      <TraceFilter
        traceId={traceId}
        onChange={(nextTraceId) => onChange({ traceId: nextTraceId })}
      />

      <Separator />

      <DedicatedAttributeSection
        repo={repo}
        domain="logs"
        timeRange={timeRange}
        attributes={attributes}
        dedicated={[ENVIRONMENT_ATTRIBUTE]}
        promotedAttributes={LOGS_PROMOTED_ATTRIBUTES}
        excludedKeys={LOGS_EXCLUDED_KEYS}
        sources={LOGS_ATTRIBUTE_SOURCES_UI}
        onChange={(next) => onChange({ attributes: next })}
      />
    </FilterSidebar>
  );
}
