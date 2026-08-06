import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import { Label } from "@everr/ui/components/label";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { Hash, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
import { ExploreFilterRail } from "../../filters/ui/explore-filter-rail";
import { FilterSearchBar } from "../../filters/ui/filter-search-bar";
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
  q: string;
  levels: LogLevel[];
  attributes: AttributeFilter[];
  traceId: string | undefined;
  levelCounts?: Record<LogLevel, number>;
  // The top zone of the rail: Service and Environment. The host app supplies it.
  persistentFilters?: ReactNode;
  persistentFilterCount?: number;
  onChange: (patch: {
    // undefined means no search, which is the shape of the search param.
    q?: string | undefined;
    levels?: LogLevel[];
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
  // Set the draft again when the trace id changes from outside this component,
  // for example on "Clear page filters", on a link, or on Back. Without this the
  // input keeps an old value and applies it again.
  const lastTraceIdRef = useRef(traceId);
  if (lastTraceIdRef.current !== traceId) {
    lastTraceIdRef.current = traceId;
    setValue(traceId ?? "");
  }

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
  q,
  levels,
  attributes,
  traceId,
  levelCounts,
  persistentFilters,
  persistentFilterCount = 0,
  onChange,
}: LogFiltersBarProps) {
  const toggleLevel = (level: LogLevel) => {
    const nextLevels = levels.includes(level)
      ? levels.filter((item) => item !== level)
      : [...levels, level];
    onChange({ levels: nextLevels });
  };

  // The count for the bottom zone of the rail.
  //
  // Each control counts one time, whatever number of values it holds. The
  // "Filters" badge then has the same meaning on every Explore page. Attribute
  // filters are different: each one is a separate control, so each one counts.
  const pageFilterCount =
    (q.length > 0 ? 1 : 0) +
    (levels.length > 0 ? 1 : 0) +
    (traceId !== undefined ? 1 : 0) +
    attributes.length;

  return (
    <ExploreFilterRail
      label="Log filters"
      persistentFilters={persistentFilters}
      persistentFilterCount={persistentFilterCount}
      pageFilterCount={pageFilterCount}
      onClear={() =>
        onChange({
          q: undefined,
          levels: [],
          attributes: [],
          traceId: undefined,
        })
      }
    >
      <FilterSearchBar
        id="logs-search"
        label="Search"
        showLabel
        value={q}
        onChange={(next) => onChange({ q: next || undefined })}
        placeholder="Search messages, errors, IDs"
      />

      <div className="flex flex-col gap-1">
        <Label className="text-muted-foreground text-xs">Severity</Label>
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
      </div>

      <TraceFilter
        traceId={traceId}
        onChange={(nextTraceId) => onChange({ traceId: nextTraceId })}
      />

      <AttributeFilterSection
        repo={repo}
        domain="logs"
        timeRange={timeRange}
        attributes={attributes}
        promotedAttributes={LOGS_PROMOTED_ATTRIBUTES}
        excludedKeys={LOGS_EXCLUDED_KEYS}
        sources={LOGS_ATTRIBUTE_SOURCES_UI}
        onChange={(next) => onChange({ attributes: next })}
      />
    </ExploreFilterRail>
  );
}
