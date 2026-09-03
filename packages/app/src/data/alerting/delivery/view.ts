/**
 * What the Notifications page reads: every channel with what reaches it and
 * its delivery record over the selected window, the default destination, the
 * rules that name channels of their own, and every way an alert went
 * nowhere. Shared by the server function that builds it and the screen that
 * draws it; the screen only draws.
 */
import type { AlertingDefaultTier } from "@/data/alerting/delivery/defaults";
import type { AlertingChannelConfig, AlertingSeverity } from "../types";

export type NotificationChannelView = {
  name: string;
  /** Secrets redacted: the config names the kind and, for Telegram, the
   *  chats it reaches, never a URL or a token. */
  config: AlertingChannelConfig;
  /** The default tiers that deliver here: `["all"]` while the destination
   *  is unsplit, the severities that name it while split, empty when none. */
  tiers: AlertingDefaultTier[];
  /** The paths of the rules that name this channel directly. */
  rules: string[];
  /** Deliveries in the window that reached the endpoint. */
  sent: number;
  /** Deliveries in the window that never did. */
  failed: number;
  lastSentAt: string | null;
  /** What the endpoint answered on the latest failed attempt in the window. */
  lastError: string | null;
};

export type NotificationDestinationView = {
  /** One channel list per severity, rather than one for every alert. */
  split: boolean;
  tiers: Record<AlertingDefaultTier, string[]>;
};

/** A rule that names channels in its YAML and so skips the default. */
export type NotificationOverrideView = {
  path: string;
  name: string;
  severity: AlertingSeverity;
  channels: string[];
};

/**
 * One way an alert reaches delivery with nothing to carry it, and what it
 * cost in the window: a default tier with no channel, or a rule naming a
 * channel nobody has. The count is of alerts that went nowhere for that
 * reason; zero says the gap is open but nothing fired into it.
 */
export type NotificationGap =
  | { kind: "tier"; tier: AlertingDefaultTier; count: number }
  | {
      kind: "missing-channel";
      rule: { path: string; name: string };
      channel: string;
      count: number;
    };

export type AlertNotificationsData = {
  channels: NotificationChannelView[];
  destination: NotificationDestinationView;
  overrides: NotificationOverrideView[];
  gaps: NotificationGap[];
};
