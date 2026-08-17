import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
} from "@everr/ui/components/card";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Pencil, Plus } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import { deleteAlertingReceiver } from "@/data/alerting/delivery/server";
import type {
  AlertingChannel,
  AlertingReceiver,
  AlertingRoute,
} from "@/data/alerting/types";
import { ReceiverBuilder } from "./receiver-builder";
import { ChannelChip } from "./route-preview";
import {
  ConfirmDeleteAction,
  DeleteOperations,
  SectionBody,
  SectionHeading,
} from "./section-chrome";

export function ReceiversSection({
  channels,
  routes,
  editing,
  onEditingChange,
  onReviewRoutes,
}: {
  channels: AlertingChannel[];
  routes: AlertingRoute[] | undefined;
  editing: AlertingReceiver | "new" | null;
  onEditingChange: (editing: AlertingReceiver | "new" | null) => void;
  onReviewRoutes: () => void;
}) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(
    deliveryQueries.receivers(),
  );
  const channelsByName = useMemo(
    () => new Map(channels.map((c) => [c.name, c])),
    [channels],
  );

  const remove = useMutation({
    mutationFn: (name: string) => deleteAlertingReceiver({ data: { name } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deliveryQueries.receivers().queryKey });
      toast.success("Receiver deleted");
    },
  });

  return (
    <Card id="receivers" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <SectionHeading>Receivers</SectionHeading>
        <CardAction>
          <Button
            variant="outline"
            className="h-10 sm:h-8"
            onClick={() => onEditingChange("new")}
          >
            <Plus data-icon="inline-start" />
            New receiver
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <SectionBody
          isError={isError}
          error={error}
          isPending={isPending}
          skeletonRows={3}
          empty={{
            when: (data ?? []).length === 0,
            icon: Inbox,
            title: "No receivers defined",
            hint: "Add a receiver that references one or more channels for routes to deliver alerts to.",
          }}
        >
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((r) => {
              const targeting = routes?.filter(
                (rt) => rt.receiver === r.name,
              ).length;
              const targetCount = targeting ?? 0;
              const confirmDisabledReason =
                routes === undefined
                  ? "Route references are still loading or unavailable. Try again after the pipeline is ready."
                  : targetCount > 0
                    ? `${targetCount} ${targetCount === 1 ? "route still targets" : "routes still target"} this receiver. Move ${targetCount === 1 ? "that route" : "those routes"} first. No changes will be made.`
                    : undefined;
              return (
                <li key={r.name} className="flex items-start gap-3 px-3 py-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Inbox className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{r.name}</span>
                      {targeting !== undefined &&
                        (targeting === 0 ? (
                          <span
                            className={cn(
                              "text-xs",
                              toneText({ tone: "warning" }),
                            )}
                          >
                            no route targets this receiver
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {targeting} {targeting === 1 ? "route" : "routes"}
                          </span>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.channels.map((name) => (
                        <ChannelChip
                          key={name}
                          name={name}
                          channel={channelsByName.get(name)}
                          missingLabel="missing"
                        />
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="size-10 sm:size-8"
                    aria-label={`Edit receiver ${r.name}`}
                    onClick={() => onEditingChange(r)}
                  >
                    <Pencil />
                  </Button>
                  <ConfirmDeleteAction
                    label={`Delete receiver ${r.name}`}
                    title={`Delete “${r.name}”?`}
                    description={
                      routes === undefined
                        ? "References must load before this receiver can be deleted."
                        : targetCount > 0
                          ? "Routes still depend on this receiver, so it cannot be deleted yet."
                          : "No route targets this receiver. This cannot be undone."
                    }
                    confirmLabel="Delete receiver"
                    pending={remove.isPending}
                    details={
                      confirmDisabledReason === undefined ? (
                        <DeleteOperations>
                          <li className="pl-1">
                            Delete <span className="font-mono">{r.name}</span>.
                            Its channels remain available.
                          </li>
                        </DeleteOperations>
                      ) : undefined
                    }
                    confirmDisabledReason={confirmDisabledReason}
                    blockedAction={
                      targetCount > 0
                        ? { label: "Review routes", onClick: onReviewRoutes }
                        : undefined
                    }
                    onConfirm={() => remove.mutateAsync(r.name)}
                  />
                </li>
              );
            })}
          </ul>
        </SectionBody>
      </CardContent>
      <ReceiverBuilder
        key={editing === "new" ? "new" : (editing?.name ?? "closed")}
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) onEditingChange(null);
        }}
        existingNames={(data ?? []).map((r) => r.name)}
        channels={channels}
        receiver={editing === "new" ? null : editing}
      />
    </Card>
  );
}
