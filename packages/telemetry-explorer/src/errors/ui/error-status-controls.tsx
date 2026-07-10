import { Button } from "@everr/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff, CircleCheck, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { CreateErrorStatusEventInput } from "../data/schemas";
import type { ErrorStatus, ErrorStatusEventType } from "../data/types";
import { InvestigationComposer } from "./error-investigation-form";
import type { ErrorTriageActions } from "./error-timeline";

// Status transitions for the Error detail header. One rule decides what shows:
// every status event type is offered except the one the Error is already in
// (open hides Reopen, resolved hides Resolve, ignored hides Ignore). Resolve
// asks for the explanation inline; Ignore and Reopen apply on click.
export function ErrorStatusControls({
  fingerprint,
  status,
  triage,
}: {
  fingerprint: string;
  /** Derived Status; undefined (still loading elsewhere) is treated as open. */
  status: ErrorStatus | undefined;
  triage: ErrorTriageActions;
}) {
  const [resolveOpen, setResolveOpen] = useState(false);
  const queryClient = useQueryClient();
  // The status event changes the derived summary, the list row, and the
  // timeline at once; the shared "errors" prefix covers all three.
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["errors"] });
  const statusMutation = useMutation({
    mutationFn: (input: CreateErrorStatusEventInput) =>
      triage.createStatusEvent(input),
    onSuccess: invalidate,
  });

  const current = status ?? "open";
  const record = (type: ErrorStatusEventType) =>
    statusMutation.mutate({ fingerprint, type, body: "" });
  const pendingType = statusMutation.isPending
    ? statusMutation.variables?.type
    : undefined;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {current !== "open" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={statusMutation.isPending}
            onClick={() => record("reopened")}
          >
            {pendingType === "reopened" ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <RotateCcw data-icon="inline-start" />
            )}
            Reopen
          </Button>
        ) : null}
        {current !== "ignored" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={statusMutation.isPending}
            onClick={() => record("ignored")}
          >
            {pendingType === "ignored" ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <BellOff data-icon="inline-start" />
            )}
            Ignore
          </Button>
        ) : null}
        {current !== "resolved" ? (
          <Popover open={resolveOpen} onOpenChange={setResolveOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={statusMutation.isPending}
                />
              }
            >
              <CircleCheck data-icon="inline-start" />
              Resolve
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-96 max-w-[calc(100vw-2rem)]"
            >
              <PopoverHeader>
                <PopoverTitle>Resolve this Error</PopoverTitle>
                <PopoverDescription>
                  The explanation is recorded in the timeline next to the
                  telemetry.
                </PopoverDescription>
              </PopoverHeader>
              <InvestigationComposer
                placeholder="What fixed it? Reference the change if you can."
                submitLabel="Resolve"
                hint="Markdown supported."
                autoFocus
                onSubmit={(body) =>
                  triage.createStatusEvent({
                    fingerprint,
                    type: "resolved",
                    body,
                  })
                }
                onSuccess={() => {
                  setResolveOpen(false);
                  invalidate();
                }}
                onCancel={() => setResolveOpen(false)}
              />
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      {statusMutation.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {statusMutation.error instanceof Error
            ? statusMutation.error.message
            : "Failed to save the status change."}
        </p>
      ) : null}
    </div>
  );
}
