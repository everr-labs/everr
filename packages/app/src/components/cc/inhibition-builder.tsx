// packages/app/src/components/cc/inhibition-builder.tsx
//
// Backs the /alerts/delivery page's dependency-mutes (inhibitions)
// section, under the Advanced delivery disclosure.
import { Button } from "@everr/ui/components/button";
import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CcConceptNote, ccErrorMessage } from "@/components/cc/shared";
import {
  type CcLabelKeySuggestion,
  createCcInhibition,
  listCcLabelKeys,
} from "@/data/cc/server";
import type { CcMatcher } from "@/data/cc/types";
import { CcDrawer } from "./cc-drawer";
import { MatchersEditor, matchersPhrase } from "./matchers-editor";
import { PreviewLine } from "./route-builder";

// The same key suggestions the matcher rows use, flattened to the string list
// FilterCombobox consumes (synthetic keys like severity/rule included).
const ccEqualKeyOptions = () => ({
  queryKey: ["cc", "label-keys"] as const,
  queryFn: () => listCcLabelKeys(),
  staleTime: 60_000,
  select: (keys: CcLabelKeySuggestion[]) => keys.map((k) => k.key),
});

export function InhibitionBuilder({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [source, setSource] = useState<CcMatcher[]>([]);
  const [target, setTarget] = useState<CcMatcher[]>([]);
  const [equal, setEqual] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: () =>
      createCcInhibition({
        data: {
          source_matchers: source,
          target_matchers: target,
          equal,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "inhibitions"] });
      onOpenChange(false);
      setSource([]);
      setTarget([]);
      setEqual([]);
      toast.success("Inhibition created");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <CcDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="New inhibition"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            Create inhibition
          </Button>
        </>
      }
    >
      <CcConceptNote>
        While a <strong>source</strong> alert is firing, matching{" "}
        <strong>target</strong> alerts are suppressed — as long as they share
        the same values for the <strong>equal</strong> labels.
      </CcConceptNote>
      <MatchersEditor
        label="Source — while this is firing"
        value={source}
        onChange={setSource}
      />
      <MatchersEditor
        label="Target — suppress these"
        value={target}
        onChange={setTarget}
      />
      {/* Key suggestions only: `equal` names labels whose VALUES must agree
          between source and target, so there is no value to pick here. */}
      <FilterCombobox
        label="Equal labels"
        values={equal}
        onChange={setEqual}
        options={ccEqualKeyOptions()}
        placeholder="No shared-value requirement"
        searchPlaceholder="Search or type a label key..."
        className="w-full font-mono"
        allowCustom
      />
      <PreviewLine>
        While an alert matching <strong>{matchersPhrase(source)}</strong> is
        firing, suppress alerts matching{" "}
        <strong>{matchersPhrase(target)}</strong>
        {equal.length > 0 ? (
          <>
            {" "}
            that share <strong>{equal.join(", ")}</strong>
          </>
        ) : null}
        .
      </PreviewLine>
    </CcDrawer>
  );
}
