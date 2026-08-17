import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "@everr/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellMinus, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import { deleteAlertingInhibition } from "@/data/alerting/delivery/server";
import type { AlertingInhibition } from "@/data/alerting/types";
import { Conditions } from "../common/labels";
import { InhibitionBuilder } from "./inhibition-builder";
import {
  ConfirmDeleteAction,
  DeleteOperations,
  SectionBody,
  SectionHeading,
} from "./section-chrome";

export function InhibitionsSection() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(
    deliveryQueries.inhibitions(),
  );
  const [open, setOpen] = useState(false);

  const remove = useMutation({
    mutationFn: (id: string) => deleteAlertingInhibition({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: deliveryQueries.inhibitions().queryKey,
      });
      toast.success("Inhibition deleted");
    },
  });

  return (
    <Card id="inhibitions" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <SectionHeading>Inhibitions</SectionHeading>
        <CardDescription>
          Suppress noisy downstream alerts while a related, higher-level alert
          is already firing.
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            className="h-10 sm:h-8"
            onClick={() => setOpen(true)}
          >
            <Plus data-icon="inline-start" />
            New inhibition
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <SectionBody
          isError={isError}
          error={error}
          isPending={isPending}
          skeletonRows={2}
          empty={{
            when: (data ?? []).length === 0,
            icon: BellMinus,
            title: "No inhibition rules",
            hint: "Add a rule to mute downstream alerts while a higher-level alert is already firing.",
          }}
        >
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((r: AlertingInhibition) => (
              <li
                key={r.id}
                className="flex items-start gap-3 px-3 py-2.5 text-xs leading-relaxed"
              >
                <div className="min-w-0 flex-1">
                  While{" "}
                  <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                    <Conditions matchers={r.source_matchers} />
                  </span>{" "}
                  fires, suppress{" "}
                  <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                    <Conditions matchers={r.target_matchers} />
                  </span>
                  {(r.equal ?? []).length > 0 && (
                    <>
                      {" "}
                      sharing{" "}
                      <span className="font-mono text-muted-foreground">
                        {(r.equal ?? []).join(", ")}
                      </span>
                    </>
                  )}
                  .
                </div>
                <ConfirmDeleteAction
                  label="Delete inhibition"
                  title="Delete this inhibition?"
                  description="Alerts currently suppressed by this rule may begin notifying immediately. This cannot be undone."
                  confirmLabel="Delete inhibition"
                  pending={remove.isPending}
                  details={
                    <DeleteOperations>
                      <li className="pl-1">
                        Delete this inhibition. Matching alerts will be
                        evaluated without it.
                      </li>
                    </DeleteOperations>
                  }
                  onConfirm={() => remove.mutateAsync(r.id)}
                />
              </li>
            ))}
          </ul>
        </SectionBody>
      </CardContent>
      <InhibitionBuilder open={open} onOpenChange={setOpen} />
    </Card>
  );
}
