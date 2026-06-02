import type { TimeRange } from "@everr/ui/lib/time-range";
import { useState } from "react";
import type { AttributeRepositoryLike } from "../repository";
import type { AttributeFilter, AttributeSource } from "../schemas";
import { AttributeFilterPill } from "./attribute-filter-pill";
import { AttributeKeyPicker } from "./attribute-key-picker";
import type { PromotedAttribute } from "./attribute-meta";

function filterKey(source: AttributeSource, key: string) {
  return `${source}:${key}`;
}

export function AttributeFilterSection({
  repo,
  domain,
  timeRange,
  attributes,
  promotedAttributes,
  excludedKeys,
  sources,
  onChange,
}: {
  repo: AttributeRepositoryLike;
  domain: string;
  timeRange: TimeRange;
  attributes: AttributeFilter[];
  promotedAttributes: PromotedAttribute[];
  excludedKeys: ReadonlySet<string>;
  sources: AttributeSource[];
  onChange: (next: AttributeFilter[]) => void;
}) {
  // The filter just added — its pill mounts with its editor open so the user
  // can pick values immediately.
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  const activeKeys = new Set(attributes.map((f) => filterKey(f.source, f.key)));

  const addFilter = (source: AttributeSource, key: string) => {
    if (activeKeys.has(filterKey(source, key))) return;
    setLastAdded(filterKey(source, key));
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
      <span className="text-muted-foreground text-xs">Attributes</span>
      {attributes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {attributes.map((filter, index) => {
            const key = filterKey(filter.source, filter.key);
            return (
              <AttributeFilterPill
                key={key}
                repo={repo}
                domain={domain}
                timeRange={timeRange}
                filter={filter}
                defaultOpen={key === lastAdded}
                onChange={(next) => updateAt(index, next)}
                onRemove={() => removeAt(index)}
              />
            );
          })}
        </div>
      )}
      <AttributeKeyPicker
        repo={repo}
        domain={domain}
        timeRange={timeRange}
        activeKeys={activeKeys}
        promotedAttributes={promotedAttributes}
        excludedKeys={excludedKeys}
        sources={sources}
        onSelect={({ source, key }) => addFilter(source, key)}
      />
    </div>
  );
}
