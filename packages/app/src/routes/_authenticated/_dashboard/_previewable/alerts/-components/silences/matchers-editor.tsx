import { Button } from "@everr/ui/components/button";
import { OptionCombobox } from "@everr/ui/components/option-combobox";
import {
  SuggestCombobox,
  type SuggestItem,
} from "@everr/ui/components/suggest-combobox";
import { LockKeyhole, Plus, X } from "lucide-react";
import { AlertingMatchOpSchema } from "@/data/alerting/schema";
import { alertingOpSymbol } from "@/data/alerting/silences/matching";
import {
  type AlertingLabelKeySuggestion,
  type AlertingLabelValueSuggestion,
  listAlertingLabelKeys,
  listAlertingLabelValues,
} from "@/data/alerting/silences/suggestions";
import type { AlertingMatcher } from "@/data/alerting/types";

/**
 * True when every matcher has a label and therefore narrows the set.
 */
export function matchersAreScoped(m: AlertingMatcher[]): boolean {
  return m.length > 0 && m.every((x) => x.label.trim() !== "");
}

export function addMatcher(m: AlertingMatcher[]): AlertingMatcher[] {
  return [...m, { label: "", op: "eq", value: "" }];
}
export function removeMatcher(
  m: AlertingMatcher[],
  i: number,
): AlertingMatcher[] {
  return m.filter((_, idx) => idx !== i);
}
export function updateMatcher(
  m: AlertingMatcher[],
  i: number,
  patch: Partial<AlertingMatcher>,
): AlertingMatcher[] {
  return m.map((row, idx) => (idx === i ? { ...row, ...patch } : row));
}

// Cached briefly so hopping between matcher rows doesn't refetch; the
// comboboxes fetch only while open, so loading never blocks typing.
const SUGGESTION_STALE_MS = 60_000;

/** Synthetic keys carry a tag. */
const alertingLabelKeyOptions = () => ({
  queryKey: ["alerting", "label-keys"] as const,
  queryFn: () => listAlertingLabelKeys(),
  staleTime: SUGGESTION_STALE_MS,
  select: (keys: AlertingLabelKeySuggestion[]): SuggestItem[] =>
    keys.map((k) => ({
      value: k.key,
      tag: k.synthetic ? "synthetic" : undefined,
    })),
});

/** An unset key resolves to no suggestions. */
const alertingLabelValueOptions = (key: string) => ({
  queryKey: ["alerting", "label-values", key] as const,
  queryFn: () =>
    key
      ? listAlertingLabelValues({ data: { key } })
      : Promise.resolve<AlertingLabelValueSuggestion[]>([]),
  staleTime: SUGGESTION_STALE_MS,
  select: (values: AlertingLabelValueSuggestion[]): SuggestItem[] =>
    values.map((v) => ({
      value: v.value,
      ...(v.hint ? { label: v.hint, hint: v.value } : {}),
    })),
});

export function MatchersEditor({
  value,
  onChange,
  label = "Matchers",
  addLabel = "Add",
  lockedCount = 0,
  lockedValueLabels = [],
}: {
  value: AlertingMatcher[];
  onChange: (m: AlertingMatcher[]) => void;
  label?: string;
  addLabel?: string;
  lockedCount?: number;
  lockedValueLabels?: readonly (string | undefined)[];
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
      {value.map((row, i) => {
        const locked = i < lockedCount;
        return (
          <div
            key={i}
            className="grid grid-cols-[minmax(0,1fr)_4rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)_2.5rem]"
          >
            <SuggestCombobox
              label="Matcher label"
              placeholder="label"
              className="min-w-0 flex-1"
              value={row.label}
              disabled={locked}
              onChange={(label) => onChange(updateMatcher(value, i, { label }))}
              options={alertingLabelKeyOptions()}
            />
            <OptionCombobox
              label="Matcher operator"
              className="w-16 shrink-0"
              value={row.op}
              disabled={locked}
              onChange={(op) =>
                onChange(
                  updateMatcher(value, i, {
                    op: op as AlertingMatcher["op"],
                  }),
                )
              }
              options={AlertingMatchOpSchema.options.map((op) => ({
                value: op,
                label: (
                  <span className="font-mono">{alertingOpSymbol(op)}</span>
                ),
              }))}
            />
            <SuggestCombobox
              label="Matcher value"
              placeholder="value"
              className="min-w-0 flex-1"
              value={row.value}
              disabled={locked}
              displayValue={locked ? lockedValueLabels[i] : undefined}
              onChange={(v) => onChange(updateMatcher(value, i, { value: v }))}
              options={alertingLabelValueOptions(row.label)}
            />

            {locked ? (
              <span
                className="inline-flex size-8 items-center justify-center justify-self-end text-muted-foreground"
                role="img"
                aria-label={`Matcher ${i + 1} is locked`}
              >
                <LockKeyhole className="size-3.5" aria-hidden />
              </span>
            ) : (
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
            )}
          </div>
        );
      })}
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">All alerts.</span> No
          matchers added.
        </p>
      )}
    </div>
  );
}
