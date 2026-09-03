/**
 * What the Notifications page's rows mean, built from what the loaders
 * fetched. Pure, so every attribution here is testable without a database.
 */
import type { AlertingDefaultTier } from "@/data/alerting/delivery/defaults";
import type { DefinitionRow } from "@/data/alerting/triage/rules";
import { rulePath, ruleTitle } from "@/data/alerting/triage/rules";
import type { AlertingChannel } from "../types";
import type { ChannelDeliveryRecord, UndeliveredRecord } from "./record";
import type { AlertingDefaultDestination } from "./repository";
import type {
  AlertNotificationsData,
  NotificationChannelView,
  NotificationDestinationView,
  NotificationOverrideView,
  NotificationUndelivered,
} from "./view";

const SEVERITY_TIERS = ["critical", "warning", "info"] as const;

/**
 * The destination as the page draws it. Split is what the record says: the
 * repository keeps "all" and the severity tiers exclusive, so any severity
 * row means the org opted in, and every tier is filled in so the screen never
 * reads an absent key as anything but empty.
 */
export function destinationView(
  destination: AlertingDefaultDestination,
): NotificationDestinationView {
  const split = SEVERITY_TIERS.some(
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
  return rules
    .filter((rule) => (rule.spec.notifications?.channels ?? []).length > 0)
    .map((rule) => ({
      path: rulePath(rule),
      name: ruleTitle(rule),
      severity: rule.spec.severity,
      channels: rule.spec.notifications?.channels ?? [],
    }));
}

/**
 * Each `no_channels` count laid at the door of what had no channel. A rule
 * that names its own channels was on the direct path, so its count is the
 * rule's; anything else went through the default, to the tier its severity
 * selects, or to "all" while the destination is unsplit.
 *
 * The attribution reads the destination as it is now, which is what the
 * page's gap rows are derived from. A tier filled since the window began
 * keeps its count in the record, but with no row to carry it the count goes
 * unshown rather than laid on a tier that has channels.
 */
export function attributeUndelivered(
  records: UndeliveredRecord[],
  overrides: NotificationOverrideView[],
  destination: NotificationDestinationView,
): NotificationUndelivered {
  const direct = new Set(overrides.map((rule) => rule.path));
  const tiers: NotificationUndelivered["tiers"] = {};
  const rules: NotificationUndelivered["rules"] = {};
  for (const record of records) {
    if (direct.has(record.path)) {
      rules[record.path] = (rules[record.path] ?? 0) + record.count;
      continue;
    }
    const tier: AlertingDefaultTier = destination.split
      ? isSeverityTier(record.severity)
        ? record.severity
        : "info"
      : "all";
    tiers[tier] = (tiers[tier] ?? 0) + record.count;
  }
  return { tiers, rules };
}

function isSeverityTier(
  severity: string,
): severity is (typeof SEVERITY_TIERS)[number] {
  return (SEVERITY_TIERS as readonly string[]).includes(severity);
}

export function channelViews(
  channels: AlertingChannel[],
  records: ChannelDeliveryRecord[],
): NotificationChannelView[] {
  const byName = new Map(records.map((r) => [r.channel, r]));
  return channels.map((channel) => {
    const record = byName.get(channel.name);
    return {
      name: channel.name,
      config: channel.config,
      sent: record?.sent ?? 0,
      failed: record?.failed ?? 0,
      lastSentAt: record?.lastSentAt ?? null,
      lastError: record?.lastError ?? null,
    };
  });
}

export function assembleNotifications(input: {
  channels: AlertingChannel[];
  destination: AlertingDefaultDestination;
  rules: DefinitionRow[];
  records: ChannelDeliveryRecord[];
  undelivered: UndeliveredRecord[];
}): AlertNotificationsData {
  const destination = destinationView(input.destination);
  const overrides = overrideViews(input.rules);
  return {
    channels: channelViews(input.channels, input.records),
    destination,
    overrides,
    undelivered: attributeUndelivered(
      input.undelivered,
      overrides,
      destination,
    ),
  };
}
