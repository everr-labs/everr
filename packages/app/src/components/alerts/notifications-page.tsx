import { Button } from "@everr/ui/components/button";
import { GroupBand } from "@everr/ui/components/group-band";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Pencil, Plus, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import {
  ALERTING_SEVERITY_TIERS,
  type AlertingDefaultTier,
} from "@/data/alerting/delivery/defaults";
import type {
  AlertNotificationsData,
  NotificationChannelView,
  NotificationGap,
  NotificationOverrideView,
} from "@/data/alerting/delivery/view";
import type { AlertingSeverity } from "@/data/alerting/types";
import { SEVERITY_DOT, TIER_LABEL } from "./alert-status";
import { ChannelMark, channelDetail } from "./channel-mark";
import { LoadingRows, ROW_HOVER, ROW_TARGET } from "./list-row";

const DOCS_HREF = "https://everr.dev/docs/guides/set-up-notifications";

/**
 * Narrow, the row is the channel with its facts wrapped on a line beneath;
 * at full width it is the table. Only the identity column flexes. The two
 * routing lists share the
 * second track, so a tier's or a rule's channels sit under the channels'
 * Receives column.
 */
const COLUMNS =
  "grid grid-cols-1 items-center gap-x-4 gap-y-1.5 @[52rem]/list:grid-cols-[minmax(0,1fr)_13rem]";

const ROUTE_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 @[52rem]/list:grid-cols-[minmax(0,1fr)_13rem_minmax(0,1fr)]";

const EMPTY_ROW = "border-t px-3 py-3 text-sm text-muted-foreground";

function Severities({ tiers }: { tiers: readonly AlertingSeverity[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      {tiers.map((tier) => (
        <span key={tier} className="inline-flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[tier])} />
          {TIER_LABEL[tier]}
        </span>
      ))}
    </span>
  );
}

/** Which default tiers deliver to a channel, and how many rules name it. */
function Receives({ channel }: { channel: NotificationChannelView }) {
  const { tiers, rules } = channel;
  if (tiers.length === 0 && rules.length === 0) {
    return <span className="text-xs text-muted-foreground">not in use</span>;
  }
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {tiers[0] === "all" ? (
        <span>{TIER_LABEL.all}</span>
      ) : tiers.length > 0 ? (
        <Severities tiers={tiers as AlertingSeverity[]} />
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

/**
 * A channel row opens its editor the way a triage row opens its rule: the
 * row washes under the pointer and the name is the control, so there is one
 * way in for a mouse and one for a keyboard.
 */
function ChannelRow({
  channel,
  onOpen,
}: {
  channel: NotificationChannelView;
  onOpen: () => void;
}) {
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
            title={`Edit ${channel.name}`}
            className={cn(ROW_TARGET, "block font-medium")}
          >
            {channel.name}
          </button>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {channelDetail(channel.config)}
          </div>
        </div>
      </div>
      {/* One wrapped line under the name while the list is narrow; the
          table's own columns once it is not. */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 pl-10 @[52rem]/list:contents">
        <Receives channel={channel} />
      </div>
    </li>
  );
}

function alerts(n: number): string {
  return `${n} ${n === 1 ? "alert" : "alerts"}`;
}

/**
 * One gap as the row says it: what has no channel, what it cost in range,
 * and the one act that closes it. The gap itself was decided server-side;
 * this is only its wording.
 */
function GapRow({
  gap,
  channelCount,
  pending,
  onEditDelivery,
  onNewChannel,
}: {
  gap: NotificationGap;
  channelCount: number;
  pending: boolean;
  onEditDelivery: () => void;
  onNewChannel: (name?: string) => void;
}) {
  let what: ReactNode;
  let cost: string;
  let action: string;
  let onAction: () => void;
  if (gap.kind === "tier") {
    what =
      gap.tier === "all"
        ? "There is no default destination"
        : `${TIER_LABEL[gap.tier]} alerts have no channel`;
    cost = gap.count
      ? `${alerts(gap.count)} went nowhere`
      : "nothing fired in the selected time range";
    // Picking channels needs channels to pick from.
    action = channelCount === 0 ? "New channel" : "Pick channels";
    onAction = channelCount === 0 ? () => onNewChannel() : onEditDelivery;
  } else {
    what = (
      <>
        <Link
          to="/alerts"
          search={(prev) => ({ ...prev, alert: gap.rule.path })}
          title={gap.rule.path}
          className={cn(ROW_TARGET, "font-medium")}
        >
          {gap.rule.name}
        </Link>{" "}
        names <span className="font-mono text-xs">{gap.channel}</span>, which
        does not exist
      </>
    );
    cost = gap.count
      ? `${alerts(gap.count)} recorded undelivered`
      : "nothing fired in the selected time range";
    action = `Create ${gap.channel}`;
    onAction = () => onNewChannel(gap.channel);
  }
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <div>{what}</div>
        <div className="mt-0.5 font-mono text-xs text-chart-2 tabular-nums">
          {cost}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="-my-1"
        disabled={pending}
        onClick={onAction}
      >
        {action}
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
  channels: Map<string, NotificationChannelView>;
}) {
  return (
    <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-xs @[52rem]/list:col-span-1">
      {names.map((name) => {
        const channel = channels.get(name);
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
  channels: Map<string, NotificationChannelView>;
}) {
  return (
    <li className={cn(ROUTE_COLUMNS, "border-t px-3 py-2.5 text-sm")}>
      <div className="flex min-w-0 items-center gap-1.5 font-medium">
        {tier !== "all" && (
          <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[tier])} />
        )}
        {TIER_LABEL[tier]}
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
  channels: Map<string, NotificationChannelView>;
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
  onEditChannel: (channel: NotificationChannelView) => void;
  onEditDelivery: () => void;
}) {
  const channels = data?.channels ?? [];
  const overrides = data?.overrides ?? [];
  const gaps = data?.gaps ?? [];
  const byName = new Map(channels.map((c) => [c.name, c]));
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
              disabled={data === null || pending}
              onClick={() => onNewChannel()}
            >
              <Plus className="size-4" />
              New channel
            </Button>
          }
        >
          {data === null ? (
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
            <ul aria-labelledby="channels">
              {channels.map((channel) => (
                <ChannelRow
                  key={channel.name}
                  channel={channel}
                  onOpen={() => {
                    if (!pending) onEditChannel(channel);
                  }}
                />
              ))}
            </ul>
          )}
        </GroupBand>

        {/* The band appears only when it has something to report. A standing
            "nothing went wrong" row is a line the reader learns to skip, and
            the band is amber whenever it is here at all, which is what makes
            amber worth looking at. It stays through the load so the page does
            not shift once the counts arrive. */}
        {(data === null || gaps.length > 0) && (
          <GroupBand
            id="gaps"
            label="Not delivered"
            count={count(gaps.length)}
            hint="in range"
            icon={TriangleAlert}
            tone="warning"
          >
            {data === null ? (
              <LoadingRows count={1} label="Loading delivery gaps" />
            ) : (
              <ul aria-labelledby="gaps">
                {gaps.map((gap) => (
                  <GapRow
                    key={
                      gap.kind === "tier"
                        ? `tier:${gap.tier}`
                        : `rule:${gap.rule.path}:${gap.channel}`
                    }
                    gap={gap}
                    channelCount={channels.length}
                    pending={pending}
                    onEditDelivery={onEditDelivery}
                    onNewChannel={onNewChannel}
                  />
                ))}
              </ul>
            )}
          </GroupBand>
        )}

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
              disabled={data === null || pending || channels.length === 0}
              onClick={onEditDelivery}
            >
              <Pencil />
              Edit delivery
            </Button>
          }
        >
          {data === null ? (
            <LoadingRows count={3} label="Loading default targets" />
          ) : (
            <ul aria-labelledby="default-targets">
              {(data.destination.split
                ? ALERTING_SEVERITY_TIERS
                : (["all"] as const)
              ).map((tier) => (
                <DefaultTargetRow
                  key={tier}
                  tier={tier}
                  names={data.destination.tiers[tier]}
                  channels={byName}
                />
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
          {data === null ? (
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
                <OverrideRow key={rule.path} rule={rule} channels={byName} />
              ))}
            </ul>
          )}
        </GroupBand>
      </div>
    </div>
  );
}
