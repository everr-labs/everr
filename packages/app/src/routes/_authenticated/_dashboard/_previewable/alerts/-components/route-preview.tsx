// packages/app/src/routes/_authenticated/_dashboard/_previewable/alerts/-components/route-preview.tsx
//
// The Delivery page's confidence feature: build a label set (key/value
// comboboxes prepopulated from real alerts, custom entries welcome) and see
// exactly which route(s) the dispatcher would select and which channels the
// alert would reach. Evaluation happens in the page with the engine-true
// helpers (route-resolution.ts); this component owns the label builder and
// the fan-out readout, and the page mirrors the match into the pipeline
// highlight.
import { Button } from "@everr/ui/components/button";
import { SuggestCombobox } from "@everr/ui/components/suggest-combobox";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, X, Zap } from "lucide-react";
import { useState } from "react";
import type { CcChannel, CcReceiver, CcRoute } from "@/data/cc/types";
import { ccLabelKeyOptions, ccLabelValueOptions } from "./matchers-editor";
import { Pill } from "./shared";

/**
 * A channel as a compact chip: name plus resolved type. Shared with the
 * Delivery pipeline, which emphasizes the chips on the matched route and
 * labels unresolved channels via `missingLabel`.
 */
export function ChannelChip({
  name,
  channel,
  emphasized = false,
  missingLabel,
}: {
  name: string;
  channel: CcChannel | undefined;
  emphasized?: boolean;
  /** Shown in place of the type when the channel doesn't resolve; omit to show nothing. */
  missingLabel?: string;
}) {
  const type = channel ? channel.config.type : missingLabel;
  return (
    <Pill
      className={
        emphasized
          ? "border-primary/40 bg-primary/10 text-foreground"
          : undefined
      }
    >
      <span className="text-foreground">{name}</span>
      {type != null && <span className="text-muted-foreground">{type}</span>}
    </Pill>
  );
}

export function RoutePreview({
  labels,
  onLabelsChange,
  matchedRoutes,
  receiversByName,
  channelsByName,
  subscriberCount,
  prefill,
}: {
  /** The label set under evaluation (empty object = preview inactive). */
  labels: Record<string, string>;
  onLabelsChange: (labels: Record<string, string>) => void;
  /** ccSelectRoutes(...) result for `labels`; ignored while inactive. */
  matchedRoutes: CcRoute[];
  receiversByName: Map<string, CcReceiver>;
  channelsByName: Map<string, CcChannel>;
  subscriberCount: number;
  /** A firing instance's dispatch-time (synthetic) label set, when one exists. */
  prefill: Record<string, string> | null;
}) {
  // The pair under construction: pick (or type) a key, then picking a value
  // commits the pair as a chip and resets for the next one.
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
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {entries.map(([k, v]) => (
          <Pill key={k} className="border-primary/40 bg-primary/10">
            <span className="text-muted-foreground">{k}</span>
            <span className="text-muted-foreground/60">=</span>
            <span className="text-foreground">{v}</span>
            <button
              type="button"
              aria-label={`Remove label ${k}`}
              onClick={() => removeKey(k)}
              className="ml-0.5 rounded text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:text-foreground focus-visible:outline-primary"
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
          options={ccLabelKeyOptions()}
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
          options={ccLabelValueOptions(draftKey)}
        />
        {prefill && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onLabelsChange(prefill)}
          >
            <Zap data-icon="inline-start" />
            Prefill from firing instance
          </Button>
        )}
        {active && (
          <Button variant="ghost" size="sm" onClick={() => onLabelsChange({})}>
            Clear
          </Button>
        )}
      </div>
      {/* The verdict: who finds out. aria-live so keyboard entry reads back. */}
      <div aria-live="polite" className="text-xs">
        {!active ? (
          <span className="text-muted-foreground">
            Enter a label set to see exactly who would be notified. The
            dispatcher matches labels plus synthetic severity, status, rule, and
            kind.
          </span>
        ) : matchedRoutes.length === 0 ? (
          <span
            className={cn(
              "font-mono",
              toneText({
                tone: subscriberCount === 0 ? "warning" : "live",
              }),
            )}
          >
            no route matches{" "}
            <ArrowRight aria-hidden className="inline size-3" /> firehose ·{" "}
            {subscriberCount === 0
              ? "no subscribers"
              : `${subscriberCount} webhook${subscriberCount === 1 ? "" : "s"}`}
          </span>
        ) : (
          <div className="space-y-1">
            {receivers.map((name) => {
              const receiver = receiversByName.get(name);
              return (
                <div
                  key={name}
                  className="flex flex-wrap items-center gap-1.5 font-mono"
                >
                  <ArrowRight aria-hidden className="size-3 text-primary" />
                  <span className="font-medium text-foreground">{name}</span>
                  {receiver ? (
                    receiver.channels.map((ch) => (
                      <ChannelChip
                        key={ch}
                        name={ch}
                        channel={channelsByName.get(ch)}
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
        )}
      </div>
    </div>
  );
}
