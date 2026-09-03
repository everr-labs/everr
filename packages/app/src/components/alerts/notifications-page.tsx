import { Button } from "@everr/ui/components/button";
import { GroupBand } from "@everr/ui/components/group-band";
import { Skeleton } from "@everr/ui/components/skeleton";
import { kickerClass } from "@everr/ui/lib/typography";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Pencil, Plus, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { AlertingDefaultTier } from "@/data/alerting/delivery/defaults";
import type {
  AlertNotificationsData,
  NotificationChannelView,
  NotificationDestinationView,
  NotificationOverrideView,
} from "@/data/alerting/delivery/view";
import { formatElapsed } from "@/data/alerting/triage/format";
import type { AlertingSeverity } from "@/data/alerting/types";
import { ChannelMark, channelDetail } from "./channel-mark";
import { ROW_HOVER, ROW_TARGET } from "./list-row";

const DOCS_HREF = "https://everr.dev/docs/guides/set-up-notifications";

const SEVERITIES = ["critical", "warning", "info"] as const;

const SEVERITY_LABEL: Record<AlertingSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

const SEVERITY_DOT: Record<AlertingSeverity, string> = {
  critical: "bg-destructive",
  warning: "bg-chart-2",
  info: "bg-muted-foreground",
};

/**
 * Narrow, the row is the channel with its facts wrapped on a line beneath;
 * at full width it is the table. Only the identity column flexes: the other
 * three print content of a known width. The two routing lists share the
 * second track, so a tier's or a rule's channels sit under the channels'
 * Receives column.
 */
const COLUMNS =
  "grid grid-cols-1 items-center gap-x-4 gap-y-1.5 @[52rem]/list:grid-cols-[minmax(0,1fr)_13rem_10rem_6rem]";

const ROUTE_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 @[52rem]/list:grid-cols-[minmax(0,1fr)_13rem_minmax(0,1fr)]";

const EMPTY_ROW = "border-t px-3 py-3 text-sm text-muted-foreground";

function Severities({ tiers }: { tiers: readonly AlertingSeverity[] }) {
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

function agoText(at: string | null, now: number): string | null {
  if (!at) return null;
  return `${formatElapsed(now - new Date(at).getTime())} ago`;
}

/** Which default tiers deliver to a channel; every tier reads as "All
 *  alerts" while the destination is unsplit, which is what the band says. */
function Receives({
  destination,
  name,
  rules,
}: {
  destination: NotificationDestinationView;
  name: string;
  rules: number;
}) {
  const inDefault = destination.split
    ? SEVERITIES.filter((tier) => destination.tiers[tier].includes(name))
    : destination.tiers.all.includes(name)
      ? ("all" as const)
      : [];
  const nothing = inDefault !== "all" && inDefault.length === 0 && rules === 0;
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
      {rules > 0 && (
        <span className="text-muted-foreground">
          + {rules} {rules === 1 ? "rule" : "rules"} by name
        </span>
      )}
    </div>
  );
}

/**
 * A channel row opens its editor the way a triage row opens its rule: the
 * row washes under the pointer and the name is the control, so there is one
 * way in for a mouse and one for a keyboard.
 */
function ChannelRow({
  channel,
  data,
  now,
  onOpen,
}: {
  channel: NotificationChannelView;
  data: AlertNotificationsData;
  now: number;
  onOpen: () => void;
}) {
  const { name } = channel;
  const rules = data.overrides.filter((r) => r.channels.includes(name)).length;
  const sent = channel.sent + channel.failed > 0;
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
            {channelDetail(channel.config)}
          </div>
        </div>
      </div>
      {/* One wrapped line under the name while the list is narrow; the
          table's own columns once it is not. */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 pl-10 @[52rem]/list:contents">
        <Receives destination={data.destination} name={name} rules={rules} />
        <div className="min-w-0 font-mono text-xs tabular-nums">
          {sent ? (
            <div className="flex flex-col gap-0.5">
              <span>
                {channel.sent} sent
                {channel.failed > 0 && (
                  <span className="text-destructive">
                    {" "}
                    · {channel.failed} failed
                  </span>
                )}
              </span>
              {channel.lastError && (
                <span className="truncate text-destructive/80">
                  {channel.lastError}
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
          {agoText(channel.lastSentAt, now)}
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

function alertsWentNowhere(n: number | undefined): string {
  if (!n) return "nothing fired in the selected time range";
  return `${n} ${n === 1 ? "alert" : "alerts"} went nowhere`;
}

/**
 * Every way an alert in range reached delivery with nothing to carry it: a
 * default tier with no channel, or a rule naming a channel nobody has. Each
 * is one row with the one act that closes it.
 */
function deriveGaps(
  data: AlertNotificationsData,
  actions: { editDelivery: () => void; newChannel: (name?: string) => void },
): Gap[] {
  const { destination, undelivered } = data;
  const gaps: Gap[] = [];
  if (!destination.split) {
    if (destination.tiers.all.length === 0) {
      gaps.push({
        id: "tier:all",
        what: "There is no default destination",
        cost: alertsWentNowhere(undelivered.tiers.all),
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
        what: `${SEVERITY_LABEL[tier]} alerts have no channel`,
        cost: alertsWentNowhere(undelivered.tiers[tier]),
        action: "Pick channels",
        onAction: actions.editDelivery,
      });
    }
  }
  const known = new Set(data.channels.map((c) => c.name));
  for (const rule of data.overrides) {
    for (const name of rule.channels) {
      if (known.has(name)) continue;
      const n = undelivered.rules[rule.path];
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
        cost: n
          ? `${n} ${n === 1 ? "alert" : "alerts"} recorded undelivered`
          : "nothing fired in the selected time range",
        action: `Create ${name}`,
        onAction: () => actions.newChannel(name),
      });
    }
  }
  return gaps;
}

function GapRow({ gap, pending }: { gap: Gap; pending: boolean }) {
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
        disabled={pending}
        onClick={gap.onAction}
      >
        {gap.action}
      </Button>
    </li>
  );
}

/** The channels a route names, as chips; a name no channel has is flagged. */
function ChannelChips({
  names,
  channels,
}: {
  names: string[];
  channels: NotificationChannelView[];
}) {
  return (
    <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-xs @[52rem]/list:col-span-1">
      {names.map((name) => {
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
  );
}

/** One default tier and where it delivers. A tier with no channel says so
 *  here in the warning tone; the gaps band carries the cost and the action. */
function DefaultTargetRow({
  tier,
  names,
  channels,
}: {
  tier: AlertingDefaultTier;
  names: string[];
  channels: NotificationChannelView[];
}) {
  return (
    <li className={cn(ROUTE_COLUMNS, "border-t px-3 py-2.5 text-sm")}>
      <div className="flex min-w-0 items-center gap-1.5 font-medium">
        {tier !== "all" && (
          <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[tier])} />
        )}
        {tier === "all" ? "All alerts" : SEVERITY_LABEL[tier]}
      </div>
      {/* The overrides list keeps a severity here; a tier is its own. */}
      <div className="hidden @[52rem]/list:block" />
      {names.length === 0 ? (
        <span className="col-span-2 font-mono text-xs text-chart-2 @[52rem]/list:col-span-1">
          no channel · not delivered
        </span>
      ) : (
        <ChannelChips names={names} channels={channels} />
      )}
    </li>
  );
}

function OverrideRow({
  rule,
  channels,
}: {
  rule: NotificationOverrideView;
  channels: NotificationChannelView[];
}) {
  return (
    <li className={cn(ROUTE_COLUMNS, "border-t px-3 py-2.5 text-sm")}>
      <div className="min-w-0">
        {/* The same panel the triage rows open, at the same URL. */}
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
      <ChannelChips names={rule.channels} channels={channels} />
    </li>
  );
}

/**
 * Where alerts are sent, as one list per question: the channels and what each
 * one carries, every way an alert went nowhere, the default destination, and
 * the rules that route around it. The default destination is not a section
 * ahead of the channels: the Receives column answers it from the channel's
 * side, and the Default targets band answers it from the tier's.
 *
 * No page header: the shell's breadcrumb already names the screen, so the
 * list's own heading is the document's h1 and the actions sit on the bands.
 */
export function NotificationsPage({
  data,
  pending,
  onNewChannel,
  onEditChannel,
  onEditDelivery,
}: {
  /** `null` while loading. */
  data: AlertNotificationsData | null;
  /** A write is in flight; every control on the page goes inert. */
  pending: boolean;
  /** With a name, the dialog opens on that name: the act a gap row offers
   *  for a rule pointed at a channel nobody has. */
  onNewChannel: (name?: string) => void;
  onEditChannel: (name: string) => void;
  onEditDelivery: () => void;
}) {
  const now = Date.now();
  const loading = data === null;
  const gaps = data
    ? deriveGaps(data, {
        editDelivery: onEditDelivery,
        newChannel: onNewChannel,
      })
    : [];
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
          action={
            <Button
              size="sm"
              disabled={loading || pending}
              onClick={() => onNewChannel()}
            >
              <Plus className="size-4" />
              New channel
            </Button>
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
                {channels.map((channel) => (
                  <ChannelRow
                    key={channel.name}
                    channel={channel}
                    data={data}
                    now={now}
                    onOpen={() => {
                      if (!pending) onEditChannel(channel.name);
                    }}
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
                <GapRow key={gap.id} gap={gap} pending={pending} />
              ))}
            </ul>
          )}
        </GroupBand>

        {/* Where an alert goes unless its rule says otherwise: one row per
            tier while the destination is split, one for every alert while it
            is not. Same visual as the overrides below, because a tier and a
            rule are the two things that name channels. */}
        <GroupBand
          id="default-targets"
          label="Default targets"
          hint={
            data
              ? data.destination.split
                ? "split by severity"
                : "every alert"
              : undefined
          }
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={loading || pending || channels.length === 0}
              onClick={onEditDelivery}
            >
              <Pencil />
              Edit delivery
            </Button>
          }
        >
          {loading || !data ? (
            <LoadingRows count={3} label="Loading default targets" />
          ) : (
            <ul aria-labelledby="default-targets">
              {(data.destination.split ? SEVERITIES : (["all"] as const)).map(
                (tier) => (
                  <DefaultTargetRow
                    key={tier}
                    tier={tier}
                    names={data.destination.tiers[tier]}
                    channels={channels}
                  />
                ),
              )}
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
