/**
 * What the Notifications page's rows mean, built from what the loaders
 * fetched: which tiers and rules reach each channel, and every way an alert
 * went nowhere. Pure, so every attribution here is testable without a
 * database, and the screen has nothing left to derive.
 */
import {
  ALERTING_SEVERITY_TIERS,
  type AlertingDefaultTier,
  defaultTierFor,
} from "@/data/alerting/delivery/defaults";
import type { DefinitionRow } from "@/data/alerting/triage/rules";
import { rulePath, ruleTitle } from "@/data/alerting/triage/rules";
import type { AlertingChannel, AlertingDefaultDestination } from "../types";
import type { UndeliveredRecord } from "./record";
import type {
  AlertNotificationsData,
  NotificationChannelView,
  NotificationDestinationView,
  NotificationGap,
  NotificationOverrideView,
} from "./view";

/**
 * The destination as the page draws it. Split is what the record says: the
 * repository keeps "all" and the severity tiers exclusive, so any severity
 * row means the org opted in, and every tier is filled in so the screen never
 * reads an absent key as anything but empty.
 */
export function destinationView(
  destination: AlertingDefaultDestination,
): NotificationDestinationView {
  const split = ALERTING_SEVERITY_TIERS.some(
    (tier) => destination.tiers[tier] !== undefined,
  );
  return {
    split,
    tiers: {
      all: destination.tiers.all ?? [],
      critical: destination.tiers.critical ?? [],
      warning: destination.tiers.warning ?? [],
      info: destination.tiers.info ?? [],
    },
  };
}

/** The rules that name channels of their own, by the name the rest of the
 *  product calls them. Live rules only: a preview never notifies. */
export function overrideViews(
  rules: DefinitionRow[],
): NotificationOverrideView[] {
  return rules.flatMap((rule) => {
    const channels = rule.spec.notifications?.channels ?? [];
    if (channels.length === 0) return [];
    return [
      {
        path: rulePath(rule),
        name: ruleTitle(rule),
        severity: rule.spec.severity,
        channels,
      },
    ];
  });
}

/** The default tiers that deliver to a channel, in the order the lists
 *  print them: `["all"]` while unsplit, the severities that name it while
 *  split. */
function tiersReaching(
  destination: NotificationDestinationView,
  name: string,
): AlertingDefaultTier[] {
  if (!destination.split)
    return destination.tiers.all.includes(name) ? ["all"] : [];
  return ALERTING_SEVERITY_TIERS.filter((tier) =>
    destination.tiers[tier].includes(name),
  );
}

export function channelViews(
  channels: AlertingChannel[],
  destination: NotificationDestinationView,
  overrides: NotificationOverrideView[],
): NotificationChannelView[] {
  return channels.map((channel) => {
    return {
      name: channel.name,
      config: channel.config,
      tiers: tiersReaching(destination, channel.name),
      rules: overrides
        .filter((rule) => rule.channels.includes(channel.name))
        .map((rule) => rule.path),
    };
  });
}

/**
 * Every way an alert reaches delivery with nothing to carry it, with each
 * `no_channels` count laid at the door of what had no channel. A rule that
 * names its own channels was on the direct path, so its count is the rule's;
 * anything else went through the default, to the tier the mode assigns its
 * severity: the same rule the worker dispatched by, asked over the mode's
 * tiers rather than the ones with channels, since the point is which tier
 * was missing.
 *
 * The gaps read the destination as it is now. A tier filled since the window
 * began keeps its count in the record, but with no gap to carry it the count
 * goes unshown rather than laid on a tier that has channels.
 */
export function deriveGaps(
  undelivered: UndeliveredRecord[],
  overrides: NotificationOverrideView[],
  destination: NotificationDestinationView,
  channelNames: Iterable<string>,
): NotificationGap[] {
  const direct = new Set(overrides.map((rule) => rule.path));
  const modeTiers: readonly AlertingDefaultTier[] = destination.split
    ? ALERTING_SEVERITY_TIERS
    : ["all"];
  const byTier = new Map<AlertingDefaultTier, number>();
  const byRule = new Map<string, number>();
  for (const record of undelivered) {
    if (direct.has(record.path)) {
      byRule.set(record.path, (byRule.get(record.path) ?? 0) + record.count);
      continue;
    }
    const tier = defaultTierFor(modeTiers, record.severity);
    if (tier === null) continue;
    byTier.set(tier, (byTier.get(tier) ?? 0) + record.count);
  }

  const gaps: NotificationGap[] = [];
  const openTiers: AlertingDefaultTier[] = destination.split
    ? ALERTING_SEVERITY_TIERS.filter(
        (tier) => destination.tiers[tier].length === 0,
      )
    : destination.tiers.all.length === 0
      ? ["all"]
      : [];
  for (const tier of openTiers) {
    gaps.push({ kind: "tier", tier, count: byTier.get(tier) ?? 0 });
  }
  const known = new Set(channelNames);
  for (const rule of overrides) {
    for (const channel of rule.channels) {
      if (known.has(channel)) continue;
      gaps.push({
        kind: "missing-channel",
        rule: { path: rule.path, name: rule.name },
        channel,
        count: byRule.get(rule.path) ?? 0,
      });
    }
  }
  return gaps;
}

export function assembleNotifications(input: {
  channels: AlertingChannel[];
  destination: AlertingDefaultDestination;
  rules: DefinitionRow[];
  undelivered: UndeliveredRecord[];
}): AlertNotificationsData {
  const destination = destinationView(input.destination);
  const overrides = overrideViews(input.rules);
  return {
    channels: channelViews(input.channels, destination, overrides),
    destination,
    overrides,
    gaps: deriveGaps(
      input.undelivered,
      overrides,
      destination,
      input.channels.map((c) => c.name),
    ),
  };
}
