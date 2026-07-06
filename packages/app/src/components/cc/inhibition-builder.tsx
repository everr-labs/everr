// packages/app/src/components/cc/inhibition-builder.tsx
//
// Shared between the power-user CC routing page (cc-alerting/routing.tsx) and
// the unified /alerts/notifications page's "Advanced" dependency-mutes
// section, until the cc-alerting pages are retired.
import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CcConceptNote, ccErrorMessage } from "@/components/cc/shared";
import { createCcInhibition } from "@/data/cc/server";
import type { CcMatcher } from "@/data/cc/types";
import { MatchersEditor, matchersPhrase } from "./matchers-editor";
import { PreviewLine } from "./route-builder";

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
  const [equal, setEqual] = useState("");

  const create = useMutation({
    mutationFn: () =>
      createCcInhibition({
        data: {
          source_matchers: source,
          target_matchers: target,
          equal: equal
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "inhibitions"] });
      onOpenChange(false);
      setSource([]);
      setTarget([]);
      setEqual("");
      toast.success("Inhibition created");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const equalLabels = equal
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New inhibition</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <CcConceptNote>
            While a <strong>source</strong> alert is firing, matching{" "}
            <strong>target</strong> alerts are suppressed — as long as they
            share the same values for the <strong>equal</strong> labels.
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
          <div className="space-y-1.5">
            <Label htmlFor="inhibition-equal">
              Equal labels{" "}
              <span className="font-normal text-muted-foreground">
                (comma-separated)
              </span>
            </Label>
            <Input
              id="inhibition-equal"
              className="font-mono"
              value={equal}
              onChange={(e) => setEqual(e.target.value)}
              placeholder="cluster, namespace"
            />
          </div>
          <PreviewLine>
            While an alert matching <strong>{matchersPhrase(source)}</strong> is
            firing, suppress alerts matching{" "}
            <strong>{matchersPhrase(target)}</strong>
            {equalLabels.length > 0 ? (
              <>
                {" "}
                that share <strong>{equalLabels.join(", ")}</strong>
              </>
            ) : null}
            .
          </PreviewLine>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            Create inhibition
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
