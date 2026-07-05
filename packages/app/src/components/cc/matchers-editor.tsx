import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { Plus, X } from "lucide-react";
import type { CcMatcher } from "@/data/cc/types";

const OPS: { value: CcMatcher["op"]; symbol: string }[] = [
  { value: "eq", symbol: "=" },
  { value: "ne", symbol: "≠" },
  { value: "regex", symbol: "=~" },
  { value: "notregex", symbol: "!~" },
];

const OP_PHRASE: Record<CcMatcher["op"], string> = {
  eq: "=",
  ne: "≠",
  regex: "matches",
  notregex: "doesn't match",
};

/** Plain-language preview of a matcher set, e.g. "severity = critical and team = pay". */
export function matchersPhrase(m: CcMatcher[]): string {
  const real = m.filter((x) => x.label.trim() !== "");
  if (real.length === 0) return "any alert";
  return real
    .map((x) => `${x.label} ${OP_PHRASE[x.op]} ${x.value || "…"}`)
    .join(" and ");
}

export function addMatcher(m: CcMatcher[]): CcMatcher[] {
  return [...m, { label: "", op: "eq", value: "" }];
}
export function removeMatcher(m: CcMatcher[], i: number): CcMatcher[] {
  return m.filter((_, idx) => idx !== i);
}
export function updateMatcher(
  m: CcMatcher[],
  i: number,
  patch: Partial<CcMatcher>,
): CcMatcher[] {
  return m.map((row, idx) => (idx === i ? { ...row, ...patch } : row));
}

export function MatchersEditor({
  value,
  onChange,
  label = "Matchers",
}: {
  value: CcMatcher[];
  onChange: (m: CcMatcher[]) => void;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(addMatcher(value))}
        >
          <Plus data-icon="inline-start" />
          Add
        </Button>
      </div>
      {value.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and have no stable id
        <div key={i} className="flex items-center gap-2">
          <Input
            placeholder="label"
            aria-label="Matcher label"
            className="font-mono"
            value={row.label}
            onChange={(e) =>
              onChange(updateMatcher(value, i, { label: e.target.value }))
            }
          />
          <Select
            value={row.op}
            onValueChange={(op) =>
              onChange(updateMatcher(value, i, { op: op as CcMatcher["op"] }))
            }
          >
            <SelectTrigger
              aria-label="Matcher operator"
              className="w-16 shrink-0"
            >
              <SelectValue>
                {(v) => (
                  <span className="font-mono">
                    {OPS.find((o) => o.value === v)?.symbol ?? "="}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {OPS.map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  <span className="font-mono">{op.symbol}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="value"
            aria-label="Matcher value"
            className="font-mono"
            value={row.value}
            onChange={(e) =>
              onChange(updateMatcher(value, i, { value: e.target.value }))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove matcher"
            onClick={() => onChange(removeMatcher(value, i))}
          >
            <X />
          </Button>
        </div>
      ))}
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No matchers — matches everything.
        </p>
      )}
    </div>
  );
}
