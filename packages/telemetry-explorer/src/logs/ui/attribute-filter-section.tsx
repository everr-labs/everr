import { Badge } from "@everr/ui/components/badge";
import type { TimeRange } from "@everr/ui/lib/time-range";
import type { LogsRepositoryLike } from "../data/repository";
import type { AttributeFilter, AttributeSource } from "../schemas";
import { AttributeFilterRow } from "./attribute-filter-row";
import { AttributeKeyPicker } from "./attribute-key-picker";
import { PROMOTED_ATTRIBUTES } from "./attribute-meta";

function filterKey(source: AttributeSource, key: string) {
  return `${source}:${key}`;
}

export function AttributeFilterSection({
  repo,
  timeRange,
  attributes,
  onChange,
}: {
  repo: LogsRepositoryLike;
  timeRange: TimeRange;
  attributes: AttributeFilter[];
  onChange: (next: AttributeFilter[]) => void;
}) {
  const activeKeys = new Set(attributes.map((f) => filterKey(f.source, f.key)));

  const addFilter = (source: AttributeSource, key: string) => {
    if (activeKeys.has(filterKey(source, key))) return;
    onChange([...attributes, { source, key, op: "in", values: [] }]);
  };

  const updateAt = (index: number, next: AttributeFilter) => {
    onChange(attributes.map((f, i) => (i === index ? next : f)));
  };

  const removeAt = (index: number) => {
    onChange(attributes.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground text-xs font-medium">
        Attributes
      </span>
      <div className="flex flex-wrap gap-1">
        {PROMOTED_ATTRIBUTES.map((promoted) => {
          const isActive = activeKeys.has(
            filterKey(promoted.source, promoted.key),
          );
          return (
            <Badge
              key={promoted.key}
              variant={isActive ? "default" : "outline"}
              className="cursor-pointer"
              aria-pressed={isActive}
              render={<button type="button" />}
              onClick={() => addFilter(promoted.source, promoted.key)}
            >
              {promoted.label}
            </Badge>
          );
        })}
      </div>
      {attributes.map((filter, index) => (
        <AttributeFilterRow
          key={filterKey(filter.source, filter.key)}
          repo={repo}
          timeRange={timeRange}
          filter={filter}
          onChange={(next) => updateAt(index, next)}
          onRemove={() => removeAt(index)}
        />
      ))}
      <AttributeKeyPicker
        repo={repo}
        timeRange={timeRange}
        onSelect={({ source, key }) => addFilter(source, key)}
      />
    </div>
  );
}
