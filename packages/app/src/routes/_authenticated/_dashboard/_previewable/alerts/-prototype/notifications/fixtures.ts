/**
 * PROTOTYPE. Synthetic delivery configuration for the Notifications variants.
 *
 * Every state the page has to carry is present once: a channel in two tiers,
 * a channel only rules name, a channel nothing names, a tier with no channel,
 * a rule pointed at a channel that no longer exists, and a channel whose
 * sends are failing. Counts are what the ClickHouse delivery history would
 * return for the selected range; they are invented, and the bar says so.
 */
import type {
  AlertingChannelConfig,
  AlertingSeverity,
} from "@/data/alerting/types";

export const SEVERITIES = ["critical", "warning", "info"] as const;

export type Channel = {
  name: string;
  config: AlertingChannelConfig;
  createdAt: Date;
};

export type DeliveryRecord = {
  sent: number;
  failed: number;
  lastSentAt: Date | null;
  lastError: string | null;
};

export type RuleOverride = {
  path: string;
  name: string;
  severity: AlertingSeverity;
  channels: string[];
};

export type Destination = {
  split: boolean;
  /** Channel names per tier. `all` is read when unsplit. */
  tiers: Record<"all" | AlertingSeverity, string[]>;
};

const H = 60 * 60_000;
const D = 24 * H;
const now = Date.now();

export const CHANNELS: Channel[] = [
  {
    name: "#oncall",
    config: { type: "slack", url: "***" },
    createdAt: new Date(now - 112 * D),
  },
  {
    name: "pager",
    config: { type: "webhook", url: "***" },
    createdAt: new Date(now - 112 * D),
  },
  {
    name: "platform-alerts",
    config: { type: "discord", url: "***" },
    createdAt: new Date(now - 40 * D),
  },
  {
    name: "ops-telegram",
    config: {
      type: "telegram",
      bot_token: "***",
      chat_ids: ["-1002233445566"],
    },
    createdAt: new Date(now - 6 * D),
  },
];

export const DESTINATION: Destination = {
  split: true,
  tiers: {
    all: ["#oncall", "pager"],
    critical: ["#oncall", "pager"],
    warning: ["#oncall"],
    info: [],
  },
};

export const OVERRIDES: RuleOverride[] = [
  {
    path: "checkout/api-latency-p99",
    name: "API latency p99 (checkout)",
    severity: "critical",
    channels: ["platform-alerts", "#oncall"],
  },
  {
    path: "platform/k8s-node-not-ready",
    name: "Node not ready (platform)",
    severity: "warning",
    channels: ["#sre-legacy"],
  },
  {
    path: "demo/demo-flapping",
    name: "Flapping (demo)",
    severity: "info",
    channels: ["platform-alerts"],
  },
];

/** Deliveries in the selected range, per channel. */
export const DELIVERIES: Record<string, DeliveryRecord> = {
  "#oncall": {
    sent: 128,
    failed: 0,
    lastSentAt: new Date(now - 2 * H),
    lastError: null,
  },
  pager: {
    sent: 41,
    failed: 3,
    lastSentAt: new Date(now - 2 * H),
    lastError: "HTTP 429 from endpoint",
  },
  "platform-alerts": {
    sent: 9,
    failed: 0,
    lastSentAt: new Date(now - 3 * D),
    lastError: null,
  },
  "ops-telegram": { sent: 0, failed: 0, lastSentAt: null, lastError: null },
};

/** Deliveries in range, per tier and channel. Missing means none. */
export const TIER_DELIVERIES: Record<string, Record<string, DeliveryRecord>> = {
  critical: {
    "#oncall": {
      sent: 37,
      failed: 0,
      lastSentAt: new Date(now - 2 * H),
      lastError: null,
    },
    pager: {
      sent: 41,
      failed: 3,
      lastSentAt: new Date(now - 2 * H),
      lastError: "HTTP 429 from endpoint",
    },
  },
  warning: {
    "#oncall": {
      sent: 84,
      failed: 0,
      lastSentAt: new Date(now - 5 * H),
      lastError: null,
    },
  },
  info: {},
};

/** Alerts in range that reached delivery with nothing to carry them, by
 *  what left them uncarried: a default tier with no channel, or a rule that
 *  names a channel nobody has. */
export type Undelivered = {
  tiers: Partial<Record<"all" | AlertingSeverity, number>>;
  rules: Record<string, number>;
};

export const UNDELIVERED: Undelivered = {
  tiers: { info: 14 },
  rules: { "platform/k8s-node-not-ready": 6 },
};

export const MISSING_CHANNEL = "#sre-legacy";

/** Everything the Ledger reads, as one value, so the route can hand it a
 *  loaded org, an empty one, or nothing yet. */
export type LedgerData = {
  channels: Channel[];
  destination: Destination;
  overrides: RuleOverride[];
  deliveries: Record<string, DeliveryRecord>;
  undelivered: Undelivered;
};

export const LEDGER_DATA: LedgerData = {
  channels: CHANNELS,
  destination: DESTINATION,
  overrides: OVERRIDES,
  deliveries: DELIVERIES,
  undelivered: UNDELIVERED,
};

/** An org that has never made a channel: the first-run screen. */
export const LEDGER_EMPTY: LedgerData = {
  channels: [],
  destination: {
    split: false,
    tiers: { all: [], critical: [], warning: [], info: [] },
  },
  overrides: [],
  deliveries: {},
  undelivered: { tiers: { all: 9 }, rules: {} },
};
