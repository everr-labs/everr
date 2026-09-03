/**
 * What the Notifications page reads: every channel with its delivery record
 * over the selected window, the default destination, the rules that name
 * channels of their own, and what went nowhere. Shared by the server function
 * that builds it and the screen that draws it.
 */
import type { AlertingDefaultTier } from "@/data/alerting/delivery/defaults";
import type { AlertingChannelConfig, AlertingSeverity } from "../types";

export type NotificationChannelView = {
  name: string;
  /** Secrets redacted: the config names the kind and, for Telegram, the
   *  chats it reaches, never a URL or a token. */
  config: AlertingChannelConfig;
  /** Deliveries in the window that reached the endpoint. */
  sent: number;
  /** Deliveries in the window that never did. */
  failed: number;
  lastSentAt: string | null;
  /** What the endpoint last answered on a delivery that never got through. */
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

/** Alerts in the window that reached delivery with nothing to carry them,
 *  by what left them uncarried. */
export type NotificationUndelivered = {
  /** A default tier with no channel. */
  tiers: Partial<Record<AlertingDefaultTier, number>>;
  /** A rule, by path, naming a channel nobody has. */
  rules: Record<string, number>;
};

export type AlertNotificationsData = {
  channels: NotificationChannelView[];
  destination: NotificationDestinationView;
  overrides: NotificationOverrideView[];
  undelivered: NotificationUndelivered;
};
