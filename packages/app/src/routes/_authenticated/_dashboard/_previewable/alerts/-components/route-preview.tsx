import { Button } from "@everr/ui/components/button";
import { SuggestCombobox } from "@everr/ui/components/suggest-combobox";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { CheckCircle2, TriangleAlert, X, Zap } from "lucide-react";
import { useState } from "react";
import type {
  AlertingChannel,
  AlertingReceiver,
  AlertingRoute,
} from "@/data/alerting/types";
import { CHANNEL_ICON } from "./channel-meta";
import {
  alertingLabelKeyOptions,
  alertingLabelValueOptions,
} from "./matchers-editor";
import { Pill } from "./shared";

export function ChannelChip({
  name,
  channel,
  emphasized = false,
  missingLabel,
}: {
  name: string;
  channel: AlertingChannel | undefined;
  emphasized?: boolean;
  /** Shown in place of the type when the channel doesn't resolve; omit to show nothing. */
  missingLabel?: string;
}) {
  const Icon = channel ? CHANNEL_ICON[channel.config.type] : undefined;
  return (
    <Pill
      title={channel?.config.type}
      className={
        emphasized
          ? "border-primary/40 bg-primary/10 text-foreground"
          : undefined
      }
    >
      {Icon && (
        <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      )}
      <span className="text-foreground">{name}</span>
      {channel ? (
        // The icon carries the type visually; keep it for screen readers.
        <span className="sr-only">{channel.config.type}</span>
      ) : (
        missingLabel != null && (
          <span className="text-muted-foreground">{missingLabel}</span>
        )
      )}
    </Pill>
  );
}

export function RoutePreview({
  labels,
  onLabelsChange,
  matchedRoutes,
  receiversByName,
  channelsByName,
  prefill,
  valueNames,
}: {
  /** The label set under evaluation (empty object = preview inactive). */
  labels: Record<string, string>;
  onLabelsChange: (labels: Record<string, string>) => void;
  /** alertingSelectRoutes(...) result for `labels`; ignored while inactive. */
  matchedRoutes: AlertingRoute[];
  receiversByName: Map<string, AlertingReceiver>;
  channelsByName: Map<string, AlertingChannel>;
  /** A firing instance's dispatch-time (synthetic) label set, when one exists. */
  prefill: Record<string, string> | null;
  /** Human names keyed by rule and SLO ids included in the label set. */
  valueNames: Map<string, string>;
}) {
  // Picking a value commits the (key, value) pair as a chip and resets.
  const [draftKey, setDraftKey] = useState("");

  const entries = Object.entries(labels);
  const active = entries.length > 0;

  const removeKey = (key: string) => {
    const next = { ...labels };
    delete next[key];
    onLabelsChange(next);
  };

  const receivers = active
    ? [...new Set(matchedRoutes.map((r) => r.receiver))]
    : [];

  return (
    <div className={cn(active && "space-y-3")}>
      <div aria-live="polite">
        {active &&
          (matchedRoutes.length === 0 ? (
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs",
                toneText({ tone: "warning" }),
              )}
            >
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <div>
                <div className="font-medium">
                  This alert would not be delivered
                </div>
                <div className="mt-0.5 opacity-80">
                  No route matches these labels. Add a catch-all route to cover
                  it.
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
              <CheckCircle2
                aria-hidden
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  toneText({ tone: "healthy" }),
                )}
              />
              <div className="min-w-0 space-y-1.5">
                <div className="font-medium text-foreground">
                  This alert will be delivered
                </div>
                {receivers.map((name) => {
                  const receiver = receiversByName.get(name);
                  return (
                    <div
                      key={name}
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      <span className="text-muted-foreground">Notify</span>
                      <strong className="font-medium text-foreground">
                        {name}
                      </strong>
                      <span className="text-muted-foreground">via</span>
                      {receiver ? (
                        receiver.channels.map((channelName) => (
                          <ChannelChip
                            key={channelName}
                            name={channelName}
                            channel={channelsByName.get(channelName)}
                          />
                        ))
                      ) : (
                        <span className={toneText({ tone: "warning" })}>
                          receiver not found
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
      </div>

      <div className="space-y-2">
        <div>
          <div className="text-xs font-medium text-foreground">Test labels</div>
          <p className="text-xs text-muted-foreground">
            The dispatcher also adds severity, status, rule, SLO, and kind.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {entries.map(([k, v]) => (
            <Pill
              key={k}
              title={valueNames.has(v) ? `${k}=${v}` : undefined}
              className="border-primary/40 bg-primary/10"
            >
              <span className="text-muted-foreground">{k}</span>
              <span className="text-muted-foreground/60">=</span>
              <span className="text-foreground">{valueNames.get(v) ?? v}</span>
              <button
                type="button"
                aria-label={`Remove label ${k}`}
                onClick={() => removeKey(k)}
                className="-my-1 -mr-1 ml-0.5 inline-flex size-6 items-center justify-center rounded text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:text-foreground focus-visible:outline-primary"
              >
                <X className="size-3" />
              </button>
            </Pill>
          ))}
          <SuggestCombobox
            label="Preview label key"
            placeholder="label"
            className="w-36"
            value={draftKey}
            onChange={setDraftKey}
            options={alertingLabelKeyOptions()}
          />
          <SuggestCombobox
            label="Preview label value"
            placeholder="value"
            className="w-36"
            disabled={draftKey === ""}
            value=""
            onChange={(value) => {
              if (draftKey === "") return;
              onLabelsChange({ ...labels, [draftKey]: value });
              setDraftKey("");
            }}
            options={alertingLabelValueOptions(draftKey)}
          />
          {prefill && (
            <Button
              variant="outline"
              size="sm"
              className="h-10 sm:h-7"
              onClick={() => onLabelsChange(prefill)}
            >
              <Zap data-icon="inline-start" />
              Prefill from firing instance
            </Button>
          )}
          {active && (
            <Button
              variant="ghost"
              size="sm"
              className="h-10 sm:h-7"
              onClick={() => onLabelsChange({})}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
