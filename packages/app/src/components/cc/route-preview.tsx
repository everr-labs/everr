// packages/app/src/components/cc/route-preview.tsx
//
// The Delivery page's confidence feature: type a label set (key=value chips)
// and see exactly which route(s) the dispatcher would select and which
// channels the alert would reach. Evaluation happens in the page with the
// engine-true helpers (route-resolution.ts); this component owns the chip
// input and the fan-out readout, and the page mirrors the match into the
// pipeline highlight.
import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, X, Zap } from "lucide-react";
import { useState } from "react";
import type { CcChannel, CcReceiver, CcRoute } from "@/data/cc/types";

/** Parse one `key=value` entry; the first `=` splits, so values may hold `=`. */
function parsePreviewEntry(raw: string): { key: string; value: string } | null {
  const idx = raw.indexOf("=");
  if (idx <= 0) return null;
  const key = raw.slice(0, idx).trim();
  if (!key) return null;
  return { key, value: raw.slice(idx + 1).trim() };
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
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  const entries = Object.entries(labels);
  const active = entries.length > 0;

  const commit = () => {
    if (draft.trim() === "") return;
    const parsed = parsePreviewEntry(draft);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    onLabelsChange({ ...labels, [parsed.key]: parsed.value });
    setDraft("");
    setInvalid(false);
  };

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
          <span
            key={k}
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none"
          >
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
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (invalid) setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (
              e.key === "Backspace" &&
              draft === "" &&
              entries.length > 0
            ) {
              removeKey(entries[entries.length - 1][0]);
            }
          }}
          onBlur={commit}
          aria-label="Add preview label (key=value)"
          aria-invalid={invalid ? true : undefined}
          placeholder="severity=critical"
          className={cn(
            "h-8 w-44 rounded-md border border-input bg-transparent px-2 font-mono text-xs outline-none",
            "placeholder:text-muted-foreground/60 focus-visible:border-primary/60 focus-visible:ring-1 focus-visible:ring-primary/40",
            invalid && "border-destructive",
          )}
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
      {invalid && (
        <p className="text-xs text-destructive" role="alert">
          Labels are entered as key=value.
        </p>
      )}
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
              subscriberCount === 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-foreground",
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
                    receiver.channels.map((ch) => {
                      const channel = channelsByName.get(ch);
                      return (
                        <span
                          key={ch}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[0.6875rem] leading-none"
                        >
                          <span className="text-foreground">{ch}</span>
                          {channel && (
                            <span className="text-muted-foreground">
                              {channel.config.type}
                            </span>
                          )}
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">
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
