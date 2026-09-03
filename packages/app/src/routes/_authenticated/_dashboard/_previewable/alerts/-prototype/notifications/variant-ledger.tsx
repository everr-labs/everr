/**
 * PROTOTYPE variant A, "Ledger": the channel is the row.
 *
 * One list in the Silences grammar. Each channel carries what it receives,
 * what reached it in range and when, so "which channel gets what, and is it
 * working" is one scan down one column each. The default destination is not
 * a section of its own: it is the Receives column, edited from the band.
 * Gaps get their own band above the overrides, in the warning tone, because
 * an alert going nowhere is the one fact this page exists to surface.
 *
 * A channel row opens its editor the way a triage row opens its rule: the
 * row washes under the pointer and the name is the control, so there is one
 * way in for a mouse and one for a keyboard, and no third button saying
 * "Edit" on every line.
 */
import { Button } from "@everr/ui/components/button";
import { GroupBand } from "@everr/ui/components/group-band";
import { Skeleton } from "@everr/ui/components/skeleton";
import { kickerClass } from "@everr/ui/lib/typography";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Pencil, Plus, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { ROW_TARGET } from "@/components/alerts/list-row";
import type { AlertingSeverity } from "@/data/alerting/types";
import {
  type Channel,
  type Destination,
  type LedgerData,
  type RuleOverride,
  SEVERITIES,
} from "./fixtures";
import {
  agoText,
  ChannelMark,
  channelDetail,
  SEVERITY_DOT,
  SEVERITY_LABEL,
} from "./shared";

const DOCS_HREF = "https://everr.dev/docs/guides/set-up-notifications";

/** The wash a row wears while the pointer is over it, as the triage and
 *  silences rows wear it. Spelled here until `list-row` exports it. */
const ROW_HOVER = "transition-colors hover:bg-muted/25";

/**
 * Narrow, the row is the channel with its facts wrapped on a line beneath;
 * at full width it is the table. Only the identity column flexes: the other
 * three print content of a known width. The overrides list shares the second
 * track so its severity sits under the channels' Receives column.
 */
const COLUMNS =
  "grid grid-cols-1 items-center gap-x-4 gap-y-1.5 @[52rem]/list:grid-cols-[minmax(0,1fr)_13rem_10rem_6rem]";

const OVERRIDE_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 @[52rem]/list:grid-cols-[minmax(0,1fr)_13rem_minmax(0,1fr)]";

const EMPTY_ROW = "border-t px-3 py-3 text-sm text-muted-foreground";

function Severities({ tiers }: { tiers: AlertingSeverity[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      {tiers.map((tier) => (
        <span key={tier} className="inline-flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[tier])} />
          {SEVERITY_LABEL[tier]}
        </span>
      ))}
    </span>
  );
}

/** Which default tiers deliver to a channel; every tier reads as "All
 *  alerts" while the destination is unsplit, which is what the band says. */
function Receives({
  destination,
  name,
  rules,
}: {
  destination: Destination;
  name: string;
  rules: RuleOverride[];
}) {
  const inDefault = destination.split
    ? SEVERITIES.filter((tier) => destination.tiers[tier].includes(name))
    : destination.tiers.all.includes(name)
      ? ("all" as const)
      : [];
  const nothing =
    inDefault !== "all" && inDefault.length === 0 && rules.length === 0;
  if (nothing) {
    return <span className="text-xs text-muted-foreground">not in use</span>;
  }
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {inDefault === "all" ? (
        <span>All alerts</span>
      ) : inDefault.length > 0 ? (
        <Severities tiers={inDefault} />
      ) : (
        <span className="text-muted-foreground">not in the default</span>
      )}
      {rules.length > 0 && (
        <span className="text-muted-foreground">
          + {rules.length} {rules.length === 1 ? "rule" : "rules"} by name
        </span>
      )}
    </div>
  );
}

function ChannelRow({
  channel,
  data,
  now,
  onOpen,
}: {
  channel: Channel;
  data: LedgerData;
  now: number;
  onOpen: () => void;
}) {
  const { name } = channel;
  const rules = data.overrides.filter((r) => r.channels.includes(name));
  const record = data.deliveries[name];
  const sent = record ? record.sent + record.failed > 0 : false;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only row convenience, the name inside is the real button
    <li
      onClick={onOpen}
      className={cn(
        COLUMNS,
        ROW_HOVER,
        "cursor-pointer border-t px-3 py-2.5 text-sm",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <ChannelMark type={channel.config.type} />
        <div className="min-w-0">
          <button
            type="button"
            title={`Edit ${name}`}
            className={cn(ROW_TARGET, "block font-medium")}
          >
            {name}
          </button>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {channelDetail(channel)}
          </div>
        </div>
      </div>
      {/* One wrapped line under the name while the list is narrow; the
          table's own columns once it is not. */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 pl-10 @[52rem]/list:contents">
        <Receives destination={data.destination} name={name} rules={rules} />
        <div className="min-w-0 font-mono text-xs tabular-nums">
          {sent && record ? (
            <div className="flex flex-col gap-0.5">
              <span>
                {record.sent} sent
                {record.failed > 0 && (
                  <span className="text-destructive">
                    {" "}
                    · {record.failed} failed
                  </span>
                )}
              </span>
              {record.lastError && (
                <span className="truncate text-destructive/80">
                  {record.lastError}
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">nothing sent</span>
          )}
        </div>
        {/* Nothing stands in for a send that never happened: the column is
            read for when, and a dash on a silent row answers a question the
            row already answered. */}
        <div className="font-mono text-xs text-muted-foreground tabular-nums">
          {agoText(record?.lastSentAt ?? null, now)}
        </div>
      </div>
    </li>
  );
}

/** Labels for the three fact columns. The band already names the first. */
function ColumnStrip() {
  return (
    <div
      aria-hidden
      className={cn(COLUMNS, "hidden border-t px-3 py-1.5 @[52rem]/list:grid")}
    >
      <span />
      <span className={kickerClass}>Receives</span>
      <span className={kickerClass}>In range</span>
      <span className={kickerClass}>Last sent</span>
    </div>
  );
}

/** Sized to a real two-line row, so the list does not resettle under the
 *  reader when the rows it was standing in for arrive. */
function LoadingRows({ count, label }: { count: number; label: string }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="border-t px-3 py-2.5">
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

type Gap = {
  id: string;
  what: ReactNode;
  /** What it cost in range, as the count of alerts that went nowhere. */
  cost: string;
  action: string;
  onAction: () => void;
};

/**
 * Every way an alert in range reached delivery with nothing to carry it: a
 * default tier with no channel, or a rule naming a channel nobody has. Each
 * is one row with the one act that closes it.
 */
function deriveGaps(
  data: LedgerData,
  actions: { editDelivery: () => void; newChannel: (name?: string) => void },
): Gap[] {
  const { destination, undelivered } = data;
  const gaps: Gap[] = [];
  const alerts = (n: number) => `${n} ${n === 1 ? "alert" : "alerts"}`;
  if (!destination.split) {
    if (destination.tiers.all.length === 0) {
      gaps.push({
        id: "tier:all",
        what: "There is no default destination",
        cost: `${alerts(undelivered.tiers.all ?? 0)} went nowhere`,
        action: data.channels.length === 0 ? "New channel" : "Pick channels",
        onAction:
          data.channels.length === 0
            ? () => actions.newChannel()
            : actions.editDelivery,
      });
    }
  } else {
    for (const tier of SEVERITIES) {
      if (destination.tiers[tier].length > 0) continue;
      gaps.push({
        id: `tier:${tier}`,
        what: (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn("size-1.5 rounded-full", SEVERITY_DOT[tier])}
              />
              {SEVERITY_LABEL[tier]}
            </span>{" "}
            alerts have no channel
          </>
        ),
        cost: `${alerts(undelivered.tiers[tier] ?? 0)} went nowhere`,
        action: "Pick channels",
        onAction: actions.editDelivery,
      });
    }
  }
  const known = new Set(data.channels.map((c) => c.name));
  for (const rule of data.overrides) {
    for (const name of rule.channels) {
      if (known.has(name)) continue;
      gaps.push({
        id: `rule:${rule.path}:${name}`,
        what: (
          <>
            <Link
              to="/alerts"
              search={(prev) => ({ ...prev, alert: rule.path })}
              title={rule.path}
              className={cn(ROW_TARGET, "font-medium")}
            >
              {rule.name}
            </Link>{" "}
            names <span className="font-mono text-xs">{name}</span>, which does
            not exist
          </>
        ),
        cost: `${alerts(undelivered.rules[rule.path] ?? 0)} recorded undelivered`,
        action: `Create ${name}`,
        onAction: () => actions.newChannel(name),
      });
    }
  }
  return gaps;
}

function GapRow({ gap }: { gap: Gap }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <div>{gap.what}</div>
        <div className="mt-0.5 font-mono text-xs text-chart-2 tabular-nums">
          {gap.cost}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="-my-1"
        onClick={gap.onAction}
      >
        {gap.action}
      </Button>
    </li>
  );
}

function OverrideRow({
  rule,
  channels,
}: {
  rule: RuleOverride;
  channels: Channel[];
}) {
  return (
    <li className={cn(OVERRIDE_COLUMNS, "border-t px-3 py-2.5 text-sm")}>
      <div className="min-w-0">
        <Link
          to="/alerts"
          search={(prev) => ({ ...prev, alert: rule.path })}
          title={rule.path}
          className={cn(ROW_TARGET, "block font-medium")}
        >
          {rule.name}
        </Link>
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
          {rule.path}
        </div>
      </div>
      <div className="justify-self-end @[52rem]/list:justify-self-start">
        <Severities tiers={[rule.severity]} />
      </div>
      <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-xs @[52rem]/list:col-span-1">
        {rule.channels.map((name) => {
          const channel = channels.find((c) => c.name === name);
          return (
            <span
              key={name}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-md border pr-1.5 pl-1",
                channel
                  ? "text-muted-foreground"
                  : "border-chart-2/50 pl-1.5 text-chart-2",
              )}
            >
              {channel && (
                <ChannelMark
                  type={channel.config.type}
                  size="sm"
                  className="bg-transparent"
                />
              )}
              {name}
              {!channel && <span> · missing</span>}
            </span>
          );
        })}
      </div>
    </li>
  );
}

export function VariantLedger({
  data,
  now,
}: {
  /** `null` while loading. */
  data: LedgerData | null;
  now: number;
}) {
  const loading = data === null;
  // PROTOTYPE: the editors are not built; the handlers mark where they hook.
  const actions = {
    editDelivery: () => {},
    newChannel: (_name?: string) => {},
    editChannel: (_name: string) => {},
  };
  const gaps = data ? deriveGaps(data, actions) : [];
  const channels = data?.channels ?? [];
  const overrides = data?.overrides ?? [];
  const count = (n: number) => (n === 0 ? undefined : n);

  return (
    <div className="@container/list">
      {/* The topnav breadcrumb is the visible title; this is the document's. */}
      <h1 className="sr-only">Notifications</h1>

      <div className="divide-y">
        <GroupBand
          id="channels"
          label="Channels"
          count={count(channels.length)}
          // Only what the rows cannot say: with every row reading "All
          // alerts", whether that is one setting or three is the band's.
          hint={
            data && channels.length > 0
              ? data.destination.split
                ? "default split by severity"
                : "one default for all alerts"
              : undefined
          }
          action={
            <div className="flex items-center gap-2">
              {channels.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Edit delivery"
                  onClick={actions.editDelivery}
                >
                  <Pencil />
                  <span className="hidden @[52rem]/list:inline">
                    Edit delivery
                  </span>
                </Button>
              )}
              <Button
                size="sm"
                disabled={loading}
                onClick={() => actions.newChannel()}
              >
                <Plus className="size-4" />
                New channel
              </Button>
            </div>
          }
        >
          {loading ? (
            <LoadingRows count={3} label="Loading channels" />
          ) : channels.length === 0 ? (
            <p className={EMPTY_ROW}>
              <span className="block max-w-prose">
                No channels yet. Add a Slack, Discord, webhook or Telegram
                endpoint; the first one becomes the default destination, so one
                channel is a complete setup.{" "}
                <a
                  href={DOCS_HREF}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Learn more
                </a>
              </span>
            </p>
          ) : (
            <>
              <ColumnStrip />
              <ul aria-labelledby="channels">
                {channels.map((c) => (
                  <ChannelRow
                    key={c.name}
                    channel={c}
                    data={data}
                    now={now}
                    onOpen={() => actions.editChannel(c.name)}
                  />
                ))}
              </ul>
            </>
          )}
        </GroupBand>

        {/* The warning tone only while there is something to warn about: a
            band that glowed amber over "nothing went wrong" would teach the
            reader to ignore amber. */}
        <GroupBand
          id="gaps"
          label="Not delivered"
          count={count(gaps.length)}
          hint="in range"
          icon={TriangleAlert}
          tone={gaps.length > 0 ? "warning" : "neutral"}
        >
          {loading ? (
            <LoadingRows count={1} label="Loading delivery gaps" />
          ) : gaps.length === 0 ? (
            <p className={EMPTY_ROW}>
              Every alert in the selected time range had a channel to go to.
            </p>
          ) : (
            <ul aria-labelledby="gaps">
              {gaps.map((gap) => (
                <GapRow key={gap.id} gap={gap} />
              ))}
            </ul>
          )}
        </GroupBand>

        <GroupBand
          id="overrides"
          label="Rule overrides"
          count={count(overrides.length)}
          hint="set in the rule's YAML"
        >
          {loading ? (
            <LoadingRows count={2} label="Loading rule overrides" />
          ) : overrides.length === 0 ? (
            <p className={EMPTY_ROW}>
              Every rule delivers to the default destination. A rule opts out
              with{" "}
              <span className="font-mono text-xs">notifications.channels</span>{" "}
              in its YAML.
            </p>
          ) : (
            <ul aria-labelledby="overrides">
              {overrides.map((rule) => (
                <OverrideRow key={rule.path} rule={rule} channels={channels} />
              ))}
            </ul>
          )}
        </GroupBand>
      </div>
    </div>
  );
}
