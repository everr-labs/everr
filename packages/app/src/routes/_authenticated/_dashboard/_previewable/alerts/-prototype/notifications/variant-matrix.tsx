/**
 * PROTOTYPE variant C, "Matrix": severities down, channels across.
 *
 * The default destination is a grid you read like a timetable: a row per
 * tier, a column per channel, a mark where the tier delivers there and the
 * count of what travelled in range beneath it. Editing is the same grid,
 * because toggling a cell is the whole edit. A row that ends with no mark is
 * a gap and says so at its right edge; a column nothing marks is a channel
 * nobody uses. The rules that name channels of their own sit under the same
 * columns as fixed marks, so the two ways an alert reaches a channel line up.
 */
import { Button } from "@everr/ui/components/button";
import { GroupBand } from "@everr/ui/components/group-band";
import { Switch } from "@everr/ui/components/switch";
import { kickerClass } from "@everr/ui/lib/typography";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Check, Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { ROW_TARGET } from "@/components/alerts/list-row";
import type { AlertingSeverity } from "@/data/alerting/types";
import {
  CHANNELS,
  DELIVERIES,
  DESTINATION,
  type DeliveryRecord,
  type Destination,
  MISSING_CHANNEL,
  OVERRIDES,
  SEVERITIES,
  TIER_DELIVERIES,
  UNDELIVERED,
} from "./fixtures";
import {
  ChannelMark,
  channelDetail,
  DeliveryPhrase,
  SEVERITY_DOT,
  SEVERITY_LABEL,
} from "./shared";

type Tier = "all" | AlertingSeverity;

const COLUMN = "w-[7.5rem] shrink-0";

function Count({ record }: { record: DeliveryRecord | undefined }) {
  if (!record || record.sent + record.failed === 0) return null;
  return (
    <span className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
      {record.sent}
      {record.failed > 0 && (
        <span className="text-destructive"> · {record.failed} failed</span>
      )}
    </span>
  );
}

function Cell({
  on,
  record,
  label,
  fixed,
  disabled,
  onToggle,
}: {
  on: boolean;
  record: DeliveryRecord | undefined;
  label: string;
  /** Set in YAML, not here. */
  fixed?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
}) {
  const mark = (
    <span
      aria-hidden
      className={cn(
        "flex size-5 items-center justify-center rounded-full border transition-colors duration-150",
        on
          ? fixed
            ? "border-foreground/40 bg-foreground/10 text-foreground"
            : "border-primary bg-primary text-primary-foreground"
          : "border-border text-transparent group-hover/cell:border-foreground/40 group-hover/cell:text-foreground/40",
      )}
    >
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
  return (
    <div className={cn(COLUMN, "flex flex-col items-center gap-1 py-2.5")}>
      {fixed || disabled ? (
        <span className={cn(disabled && "opacity-30")} title={label}>
          {mark}
        </span>
      ) : (
        <button
          type="button"
          aria-pressed={on}
          aria-label={label}
          onClick={onToggle}
          className="group/cell rounded-full outline-2 outline-dotted outline-transparent outline-offset-2 focus-visible:outline-primary"
        >
          {mark}
        </button>
      )}
      <Count record={on ? record : undefined} />
    </div>
  );
}

export function VariantMatrix({ now }: { now: number }) {
  const [destination, setDestination] = useState<Destination>(DESTINATION);
  const columns = [...CHANNELS.map((c) => c.name), MISSING_CHANNEL];
  const tiers: Tier[] = destination.split ? [...SEVERITIES] : ["all"];

  const toggle = (tier: Tier, name: string) =>
    setDestination((d) => {
      const list = d.tiers[tier];
      return {
        ...d,
        tiers: {
          ...d.tiers,
          [tier]: list.includes(name)
            ? list.filter((n) => n !== name)
            : [...list, name],
        },
      };
    });

  const tierRecord = (tier: Tier, name: string) =>
    tier === "all" ? DELIVERIES[name] : TIER_DELIVERIES[tier]?.[name];

  const unused = CHANNELS.filter(
    (c) =>
      !tiers.some((t) => destination.tiers[t].includes(c.name)) &&
      !OVERRIDES.some((r) => r.channels.includes(c.name)),
  );

  return (
    <div className="@container/list">
      <h1 className="sr-only">Notifications</h1>
      <div className="overflow-x-auto">
        <div className="min-w-[44rem] divide-y">
          {/* Column heads: the channels. The corner carries the mode. */}
          <div className="flex items-end">
            <div className="flex min-w-[14rem] flex-1 flex-col gap-2 px-3 pb-3">
              <span className="flex w-fit items-center gap-2 text-xs">
                <Switch
                  aria-label="Split by severity"
                  checked={destination.split}
                  onCheckedChange={(split) =>
                    setDestination((d) => ({ ...d, split }))
                  }
                />
                Split by severity
              </span>
              <span className="text-xs text-muted-foreground">
                A mark sends that row's alerts to that channel. Counts are in
                range.
              </span>
            </div>
            {columns.map((name) => {
              const channel = CHANNELS.find((c) => c.name === name);
              const record = DELIVERIES[name];
              return (
                <div
                  key={name}
                  className={cn(
                    COLUMN,
                    "flex flex-col items-center gap-1.5 px-1 pb-3 text-center",
                  )}
                >
                  {channel ? (
                    <ChannelMark type={channel.config.type} />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-7 items-center justify-center rounded-md border border-dashed border-chart-2/60 font-mono text-xs text-chart-2"
                    >
                      ?
                    </span>
                  )}
                  <button
                    type="button"
                    className={cn(ROW_TARGET, "max-w-full text-sm font-medium")}
                    title={channel ? channelDetail(channel) : "does not exist"}
                  >
                    {name}
                  </button>
                  {channel ? (
                    <DeliveryPhrase
                      record={record}
                      now={now}
                      className="justify-center font-mono text-[0.6875rem]"
                    />
                  ) : (
                    <span className="font-mono text-[0.6875rem] text-chart-2">
                      does not exist
                    </span>
                  )}
                </div>
              );
            })}
            <div className="w-[11rem] shrink-0 pb-3 pr-3">
              <Button size="sm" className="float-right">
                <Plus className="size-4" />
                New channel
              </Button>
            </div>
          </div>

          <GroupBand
            id="default"
            label="Default destination"
            hint={destination.split ? "one row per severity" : "every alert"}
          >
            <div className="divide-y border-t">
              {tiers.map((tier) => {
                const gap = destination.tiers[tier].length === 0;
                const total = destination.tiers[tier].reduce(
                  (n, name) => n + (tierRecord(tier, name)?.sent ?? 0),
                  0,
                );
                return (
                  <div
                    key={tier}
                    className={cn("flex items-center", gap && "bg-chart-2/5")}
                  >
                    <div className="flex min-w-[14rem] flex-1 items-center gap-2 px-3 text-sm font-medium">
                      {tier !== "all" && (
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            SEVERITY_DOT[tier],
                          )}
                        />
                      )}
                      {tier === "all" ? "All alerts" : SEVERITY_LABEL[tier]}
                    </div>
                    {columns.map((name) => (
                      <Cell
                        key={name}
                        on={destination.tiers[tier].includes(name)}
                        record={tierRecord(tier, name)}
                        label={`${tier === "all" ? "All alerts" : SEVERITY_LABEL[tier]} to ${name}`}
                        disabled={name === MISSING_CHANNEL}
                        onToggle={() => toggle(tier, name)}
                      />
                    ))}
                    <div className="w-[11rem] shrink-0 px-3 text-right font-mono text-xs tabular-nums">
                      {gap ? (
                        <span className="inline-flex items-center gap-1.5 text-chart-2">
                          <TriangleAlert className="size-3" />
                          {tier === "info"
                            ? `${UNDELIVERED.tiers.info ?? 0} not delivered`
                            : "not delivered"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {total} sent
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </GroupBand>

          <GroupBand
            id="overrides"
            label="Rule overrides"
            count={OVERRIDES.length}
            hint="fixed in the rule's YAML"
          >
            <div className="divide-y border-t">
              {OVERRIDES.map((rule) => {
                const missing = rule.channels.includes(MISSING_CHANNEL);
                return (
                  <div
                    key={rule.path}
                    className={cn(
                      "flex items-center",
                      missing && "bg-chart-2/5",
                    )}
                  >
                    <div className="flex min-w-[14rem] flex-1 items-center gap-2 px-3">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          SEVERITY_DOT[rule.severity],
                        )}
                      />
                      <div className="min-w-0">
                        <Link
                          to="/alerts"
                          search={(prev) => ({ ...prev, alert: rule.path })}
                          title={rule.path}
                          className={cn(
                            ROW_TARGET,
                            "block text-sm font-medium",
                          )}
                        >
                          {rule.name}
                        </Link>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {rule.path}
                        </div>
                      </div>
                    </div>
                    {columns.map((name) => (
                      <Cell
                        key={name}
                        on={rule.channels.includes(name)}
                        record={undefined}
                        label={`${rule.name} to ${name}, set in YAML`}
                        fixed
                      />
                    ))}
                    <div className="w-[11rem] shrink-0 px-3 text-right font-mono text-xs tabular-nums">
                      {missing ? (
                        <span className="inline-flex items-center gap-1.5 text-chart-2">
                          <TriangleAlert className="size-3" />
                          {UNDELIVERED.rules["platform/k8s-node-not-ready"] ??
                            0}{" "}
                          undelivered
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          skips the default
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </GroupBand>

          {unused.length > 0 && (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              <span className={cn(kickerClass, "mr-2")}>Unused</span>
              {unused.map((c) => c.name).join(", ")}: no row marks{" "}
              {unused.length === 1 ? "it" : "them"}, so nothing is sent there.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
