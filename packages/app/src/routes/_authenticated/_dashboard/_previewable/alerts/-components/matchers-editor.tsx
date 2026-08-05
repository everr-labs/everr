import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { OptionCombobox } from "@everr/ui/components/option-combobox";
import {
  SuggestCombobox,
  type SuggestItem,
} from "@everr/ui/components/suggest-combobox";
import { Plus, X } from "lucide-react";
import { ccIsCatchAll, ccOpSymbol } from "@/data/cc/route-resolution";
import { CcMatchOpSchema } from "@/data/cc/schema";
import {
  type CcLabelKeySuggestion,
  type CcLabelValueSuggestion,
  listCcLabelKeys,
  listCcLabelValues,
} from "@/data/cc/server";
import type { CcMatcher } from "@/data/cc/types";

const OP_PHRASE: Record<CcMatcher["op"], string> = {
  eq: "=",
  ne: "≠",
  regex: "matches",
  notregex: "doesn't match",
};

/** Plain-language preview of a matcher set, e.g. "severity = critical and team = pay". */
export function matchersPhrase(m: CcMatcher[]): string {
  const real = m.filter((x) => x.label.trim() !== "");
  if (ccIsCatchAll(real)) return "any alert";
  return real
    .map((x) => `${x.label} ${OP_PHRASE[x.op]} ${x.value || "…"}`)
    .join(" and ");
}

/**
 * True when the set genuinely narrows. The engine reads a missing label as
 * "", so an empty-label row matches every alert.
 */
export function matchersAreScoped(m: CcMatcher[]): boolean {
  return m.length > 0 && m.every((x) => x.label.trim() !== "");
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

// Cached briefly so hopping between matcher rows doesn't refetch; the
// comboboxes fetch only while open, so loading never blocks typing.
const SUGGESTION_STALE_MS = 60_000;

/** Synthetic keys carry a tag. */
export const ccLabelKeyOptions = () => ({
  queryKey: ["cc", "label-keys"] as const,
  queryFn: () => listCcLabelKeys(),
  staleTime: SUGGESTION_STALE_MS,
  select: (keys: CcLabelKeySuggestion[]): SuggestItem[] =>
    keys.map((k) => ({
      value: k.key,
      tag: k.synthetic ? "synthetic" : undefined,
    })),
});

export const ccLabelKeyFilterOptions = () => ({
  ...ccLabelKeyOptions(),
  select: (keys: CcLabelKeySuggestion[]) => keys.map((key) => key.key),
});

/** An unset key resolves to no suggestions. */
export const ccLabelValueOptions = (key: string) => ({
  queryKey: ["cc", "label-values", key] as const,
  queryFn: () =>
    key
      ? listCcLabelValues({ data: { key } })
      : Promise.resolve<CcLabelValueSuggestion[]>([]),
  staleTime: SUGGESTION_STALE_MS,
  select: (values: CcLabelValueSuggestion[]): SuggestItem[] =>
    values.map((v) => ({ value: v.value, hint: v.hint })),
});

export function MatchersEditor({
  value,
  onChange,
  label = "Matchers",
  addLabel = "Add",
}: {
  value: CcMatcher[];
  onChange: (m: CcMatcher[]) => void;
  label?: string;
  addLabel?: string;
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
          {addLabel}
        </Button>
      </div>
      {value.map((row, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,1fr)_4rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)_2.5rem]"
        >
          <SuggestCombobox
            label="Matcher label"
            placeholder="label"
            className="min-w-0 flex-1"
            value={row.label}
            onChange={(label) => onChange(updateMatcher(value, i, { label }))}
            options={ccLabelKeyOptions()}
          />
          <OptionCombobox
            label="Matcher operator"
            className="w-16 shrink-0"
            value={row.op}
            onChange={(op) =>
              onChange(updateMatcher(value, i, { op: op as CcMatcher["op"] }))
            }
            options={CcMatchOpSchema.options.map((op) => ({
              value: op,
              label: <span className="font-mono">{ccOpSymbol(op)}</span>,
            }))}
          />
          {row.op === "regex" || row.op === "notregex" ? (
            <Input
              placeholder="pattern"
              aria-label="Matcher value"
              className="min-w-0 flex-1 font-mono"
              value={row.value}
              onChange={(e) =>
                onChange(updateMatcher(value, i, { value: e.target.value }))
              }
            />
          ) : (
            <SuggestCombobox
              label="Matcher value"
              placeholder="value"
              className="min-w-0 flex-1"
              value={row.value}
              onChange={(v) => onChange(updateMatcher(value, i, { value: v }))}
              options={ccLabelValueOptions(row.label)}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="justify-self-end"
            aria-label={`Remove condition ${i + 1}`}
            onClick={() => onChange(removeMatcher(value, i))}
          >
            <X />
          </Button>
        </div>
      ))}
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">All alerts.</span> No
          conditions added.
        </p>
      )}
    </div>
  );
}
