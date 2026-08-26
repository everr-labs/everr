// PROTOTYPE, throwaway fixture data for the silences page. Delete this file
// when the page reads real silences.

export type SilenceState = "active" | "scheduled" | "expired" | "cancelled";

export type SilenceFixture = {
  id: string;
  state: SilenceState;
  /** Every matcher, formatted. The rule is one of them like any other: a
   *  silence on `rule=a` and one on `environment=staging` are the same kind
   *  of thing, and the page reads them in the same column. */
  matchers: string;
  startsAt: string;
  endsAt: string;
  canceledAt: string | null;
  held: number;
  dropped: number;
  comment: string;
  author: string;
};

const NOW = new Date("2026-08-26T14:20:00Z").getTime();
const at = (minutesFromNow: number) =>
  new Date(NOW + minutesFromNow * 60_000).toISOString();

const FIXTURE_NOW = new Date(NOW);

export const SILENCES: SilenceFixture[] = [
  {
    id: "sil_01",
    state: "active",
    matchers: "rule=checkout/api-error-rate",
    startsAt: at(-95),
    endsAt: at(145),
    canceledAt: null,
    held: 3,
    dropped: 0,
    comment: "Payment provider maintenance window, ends 18:45 UTC",
    author: "Guido D'Orsi",
  },
  {
    id: "sil_02",
    state: "active",
    matchers: "rule=ingest/queue-lag region=eu-west-1",
    startsAt: at(-30),
    endsAt: at(30),
    canceledAt: null,
    held: 1,
    dropped: 0,
    comment: "Backfill running in eu-west-1",
    author: "Mara Ilić",
  },
  {
    id: "sil_03",
    state: "active",
    matchers: "environment=staging",
    startsAt: at(-1440),
    endsAt: at(8640),
    canceledAt: null,
    held: 12,
    dropped: 4,
    comment: "Staging is being rebuilt this week",
    author: "Guido D'Orsi",
  },
  {
    id: "sil_04",
    state: "scheduled",
    matchers: "rule=web/lcp-p75",
    startsAt: at(220),
    endsAt: at(340),
    canceledAt: null,
    held: 0,
    dropped: 0,
    comment: "CDN config rollout at 18:00 UTC",
    author: "Tomás Ferreira",
  },
  {
    id: "sil_05",
    state: "scheduled",
    matchers: "rule=billing/invoice-job-failures",
    startsAt: at(1500),
    endsAt: at(1620),
    canceledAt: null,
    held: 0,
    dropped: 0,
    comment: "Monthly close, job is expected to retry",
    author: "Mara Ilić",
  },
  {
    id: "sil_06",
    state: "expired",
    matchers: "rule=checkout/api-error-rate",
    startsAt: at(-1560),
    endsAt: at(-1500),
    canceledAt: null,
    held: 0,
    dropped: 2,
    comment: "Deploy of checkout v3.2",
    author: "Guido D'Orsi",
  },
  {
    id: "sil_07",
    state: "cancelled",
    matchers: "rule=ingest/queue-lag region=us-east-1",
    startsAt: at(-2900),
    endsAt: at(-2780),
    canceledAt: at(-2780),
    held: 0,
    dropped: 1,
    comment: "",
    author: "Tomás Ferreira",
  },
  {
    id: "sil_08",
    state: "expired",
    matchers: "rule=web/lcp-p75 page=/pricing",
    startsAt: at(-4400),
    endsAt: at(-4160),
    canceledAt: null,
    held: 0,
    dropped: 0,
    comment: "Pricing page A/B test",
    author: "Mara Ilić",
  },
  {
    id: "sil_09",
    state: "expired",
    matchers: "rule=db/replica-lag",
    startsAt: at(-7300),
    endsAt: at(-7000),
    canceledAt: null,
    held: 0,
    dropped: 6,
    comment: "Replica resync",
    author: "Guido D'Orsi",
  },
  {
    id: "sil_10",
    state: "cancelled",
    matchers: "environment=staging",
    startsAt: at(-10100),
    endsAt: at(-9950),
    canceledAt: at(-9950),
    held: 0,
    dropped: 9,
    comment: "Staging load test",
    author: "Tomás Ferreira",
  },
];

export const STATE_LABEL: Record<SilenceState, string> = {
  active: "Active",
  scheduled: "Scheduled",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const STATE_DOT: Record<SilenceState, string> = {
  active: "bg-chart-2",
  scheduled: "border border-chart-2 bg-transparent",
  expired: "bg-muted-foreground/40",
  cancelled: "border border-muted-foreground/50 bg-transparent",
};

export const impact = (s: SilenceFixture) => {
  const parts: string[] = [];
  if (s.held) parts.push(`held ${s.held}`);
  if (s.dropped) parts.push(`dropped ${s.dropped}`);
  return parts.length ? parts.join(" · ") : null;
};

const fmtDay = (d: Date) =>
  d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtClock = (d: Date) =>
  d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export const stamp = (iso: string) => {
  const d = new Date(iso);
  return `${fmtDay(d)}, ${fmtClock(d)}`;
};

export const relative = (iso: string, now = FIXTURE_NOW) => {
  const ms = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(ms);
  const unit =
    abs < 3_600_000
      ? `${Math.max(1, Math.round(abs / 60_000))}m`
      : abs < 86_400_000
        ? `${Math.round(abs / 3_600_000)}h`
        : `${Math.round(abs / 86_400_000)}d`;
  return ms < 0 ? `${unit} ago` : `in ${unit}`;
};
