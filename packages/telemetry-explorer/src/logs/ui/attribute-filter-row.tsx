import { Button } from "@everr/ui/components/button";
import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { X } from "lucide-react";
import { logAttributeValuesOptions } from "../data/options";
import type { LogsRepositoryLike } from "../data/repository";
import type { AttributeFilter, AttributeOp } from "../schemas";
import { ATTRIBUTE_OP_LABELS } from "./attribute-meta";

const OPS: AttributeOp[] = ["in", "not_in", "exists", "missing"];

export function AttributeFilterRow({
  repo,
  timeRange,
  filter,
  onChange,
  onRemove,
}: {
  repo: LogsRepositoryLike;
  timeRange: TimeRange;
  filter: AttributeFilter;
  onChange: (next: AttributeFilter) => void;
  onRemove: () => void;
}) {
  const showValues = filter.op === "in" || filter.op === "not_in";

  return (
    <div className="flex flex-col gap-1 rounded-md border p-2">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate font-mono text-xs" title={filter.key}>
          {filter.key}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${filter.key} filter`}
          onClick={onRemove}
        >
          <X className="size-3" />
        </Button>
      </div>
      <Select
        value={filter.op}
        onValueChange={(op) => onChange({ ...filter, op: op as AttributeOp })}
      >
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPS.map((op) => (
            <SelectItem key={op} value={op}>
              {ATTRIBUTE_OP_LABELS[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showValues && (
        <FilterCombobox
          label=""
          values={filter.values}
          onChange={(values) => onChange({ ...filter, values })}
          options={logAttributeValuesOptions(repo, {
            timeRange,
            source: filter.source,
            key: filter.key,
          })}
          placeholder="Any value"
          searchPlaceholder="Search values..."
          className="w-full"
        />
      )}
    </div>
  );
}
