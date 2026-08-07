import { Button } from "@everr/ui/components/button";
import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import { createAlertingInhibition } from "@/data/alerting/delivery/server";
import type { AlertingMatcher } from "@/data/alerting/types";
import {
  AlertingConceptNote,
  alertingErrorMessage,
} from "../shared/components";
import { AlertingDrawer } from "../shared/drawer";
import {
  alertingLabelKeyFilterOptions,
  MatchersEditor,
  matchersPhrase,
} from "./matchers-editor";
import { PreviewLine } from "./route-builder";

export function InhibitionBuilder({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [source, setSource] = useState<AlertingMatcher[]>([]);
  const [target, setTarget] = useState<AlertingMatcher[]>([]);
  const [equal, setEqual] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: () =>
      createAlertingInhibition({
        data: {
          source_matchers: source,
          target_matchers: target,
          equal,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: deliveryQueries.inhibitions().queryKey,
      });
      onOpenChange(false);
      setSource([]);
      setTarget([]);
      setEqual([]);
      toast.success("Inhibition created");
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
  });

  return (
    <AlertingDrawer
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
      <AlertingConceptNote>
        While a <strong>source</strong> alert is firing, matching{" "}
        <strong>target</strong> alerts are suppressed — as long as they share
        the same values for the <strong>equal</strong> labels.
      </AlertingConceptNote>
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
      {/* Key suggestions only: `equal` names labels whose values must agree
          between source and target, so there is no value to pick. */}
      <FilterCombobox
        label="Equal labels"
        values={equal}
        onChange={setEqual}
        options={alertingLabelKeyFilterOptions()}
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
    </AlertingDrawer>
  );
}
