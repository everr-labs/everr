import { Button } from "@everr/ui/components/button";
import { Card, CardContent, CardHeader } from "@everr/ui/components/card";
import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, Check } from "lucide-react";
import type { ReactNode } from "react";
import type { ChannelType } from "./channel-meta";
import { ChannelTypeLauncher } from "./channel-type-picker";
import { SectionHeading } from "./section-chrome";

export type AlertingSetupState = {
  channelCount: number;
  receiverCount: number;
  routeCount: number;
};

type Step = {
  title: string;
  /** What the step is for, in one line. Omitted once the step is done. */
  hint: string;
  done: boolean;
  /** Stated instead of the action while an earlier step is missing. */
  blocked?: string;
  action?: ReactNode;
  doneLabel: string;
};

function StepMarker({ index, done }: { index: number; done: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "z-1 flex size-6 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-medium tabular-nums",
        done
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-card text-muted-foreground",
      )}
    >
      {done ? <Check className="size-3.5" /> : index + 1}
    </span>
  );
}

/**
 * The three things that have to exist before an alert reaches anybody, in the
 * order they can be built.
 *
 * Every step reads its state from the configuration itself, so the guide is
 * never a checklist the reader has to dismiss: it disappears when the last
 * step is satisfied and returns if the setup is taken apart again.
 */
export function AlertingSetupGuide({
  state,
  onAddChannel,
  onAddReceiver,
  onOpenRouting,
}: {
  state: AlertingSetupState;
  onAddChannel: (type: ChannelType | null) => void;
  onAddReceiver: () => void;
  onOpenRouting: () => void;
}) {
  const { channelCount, receiverCount, routeCount } = state;
  const steps: Step[] = [
    {
      title: "Add a channel",
      hint: "Where a notification lands: a chat webhook, a bot, or any URL that takes JSON.",
      done: channelCount > 0,
      doneLabel: `${channelCount} ${channelCount === 1 ? "channel" : "channels"}`,
      action: <ChannelTypeLauncher labelPrefix="Add" onPick={onAddChannel} />,
    },
    {
      title: "Group channels into a receiver",
      hint: "A receiver is the name routes deliver to, and every channel in it gets the alert.",
      done: receiverCount > 0,
      doneLabel: `${receiverCount} ${receiverCount === 1 ? "receiver" : "receivers"}`,
      ...(channelCount === 0
        ? { blocked: "Waiting on the first channel." }
        : {
            action: (
              <Button variant="outline" onClick={onAddReceiver}>
                New receiver
              </Button>
            ),
          }),
    },
    {
      title: "Route alerts to the receiver",
      hint: "Routing decides which alerts reach which receiver. Until a route matches, nothing is sent.",
      done: routeCount > 0,
      doneLabel: `${routeCount} ${routeCount === 1 ? "route" : "routes"}`,
      ...(receiverCount === 0
        ? { blocked: "Waiting on the first receiver." }
        : {
            action: (
              <Button variant="outline" onClick={onOpenRouting}>
                Open routing
                <ArrowRight data-icon="inline-end" />
              </Button>
            ),
          }),
    },
  ];

  const remaining = steps.filter((step) => !step.done);
  if (remaining.length === 0) return null;

  // Only the last step left: the page below is a working configuration, so the
  // guide shrinks to the one sentence that still matters.
  const last = remaining[0];
  if (remaining.length === 1 && last && last === steps[2]) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-card px-3 py-2.5 ring-1 ring-foreground/10">
        <StepMarker index={2} done={false} />
        <p className="min-w-0 flex-1 text-xs">
          <span className="font-medium">{last.title}.</span>{" "}
          <span className="text-muted-foreground">{last.hint}</span>
        </p>
        {last.blocked ? (
          <span className="text-xs text-muted-foreground">{last.blocked}</span>
        ) : (
          last.action
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeading>Set up notifications</SectionHeading>
      </CardHeader>
      <CardContent>
        <ol className="space-y-4">
          {steps.map((step, index) => (
            <li key={step.title} className="relative flex gap-3">
              {index < steps.length - 1 && (
                <span
                  aria-hidden
                  className="absolute top-6 bottom-[-1.25rem] left-3 w-px -translate-x-1/2 bg-border"
                />
              )}
              <StepMarker index={index} done={step.done} />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span
                    className={cn(
                      "text-sm font-medium",
                      step.done && "text-muted-foreground",
                    )}
                  >
                    {step.title}
                  </span>
                  {step.done && (
                    <span className="text-xs text-muted-foreground">
                      {step.doneLabel}
                    </span>
                  )}
                </div>
                {!step.done && (
                  <>
                    <p className="max-w-prose text-xs text-muted-foreground">
                      {step.hint}
                    </p>
                    {step.blocked ? (
                      <p className="text-xs text-muted-foreground/80">
                        {step.blocked}
                      </p>
                    ) : (
                      step.action
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
