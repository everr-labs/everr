import { formatLabels } from "@/data/alerts/matchers";
import {
  type BuildOptions,
  type DeliveryInput,
  type DeliveryKind,
  escapeHtml,
  formatUtc,
  instanceDetail,
  instanceLines,
  KIND_STATUS,
  longestDuration,
  MAX_LISTED_INSTANCES,
  type NotifiableInstance,
} from "./04-format";

export interface AlertEmail {
  subject: string;
  text: string;
  html: string;
}

// Hex equivalents of the oklch theme tokens in packages/ui global.css — the
// app ships a single dark theme, and the email mirrors it. Text colors are
// tuned so every (color, background, size, weight) combination clears its
// APCA (WCAG 3 draft) Lc threshold: ≥90 for running text, ≥75 for the small
// bold labels, ≥60 for the large stat numbers.
const COLORS = {
  card: "#171717", // --card
  panel: "#0a0a0a", // --background
  border: "#262626", // ~--border on the card
  foreground: "#fafafa", // --foreground; Lc -103 on card
  body: "#e6e6e6", // running text; Lc -90 on card
  muted: "#cdcdcd", // small bold labels; Lc -75 on card
  primary: "#d7ff00", // --primary (Everr chartreuse); Lc -96 on card
  primaryForeground: "#0a0a0a", // Lc 96 on primary
  destructiveStrip: "#ff6467", // --destructive, non-text use only
  destructiveDetail: "#ffbcbe", // 13px/600 details; Lc -75 on card
  destructiveStat: "#ff9395", // 18px/600 stats; Lc -60 on panel
  amberStrip: "#fbbf24", // non-text use only
} as const;

// Email layers colors on top of the shared kind → emoji/label presentation.
const STATUS: Record<
  DeliveryKind,
  {
    label: string;
    strip: string;
    badgeText: string;
    badgeBg: string;
    emoji: string;
  }
> = {
  firing: {
    ...KIND_STATUS.firing,
    strip: COLORS.destructiveStrip,
    badgeText: COLORS.primaryForeground,
    badgeBg: COLORS.destructiveStrip,
  },
  partial_resolved: {
    ...KIND_STATUS.partial_resolved,
    strip: COLORS.amberStrip,
    badgeText: "#fcd368", // Lc -80 on the badge bg
    badgeBg: "#2a2110",
  },
  resolved: {
    ...KIND_STATUS.resolved,
    strip: COLORS.primary,
    badgeText: COLORS.primary, // Lc -94 on the badge bg
    badgeBg: "#262b0a",
  },
};

export function buildAlertEmail(
  input: DeliveryInput,
  listed: readonly NotifiableInstance[],
  opts: BuildOptions,
): AlertEmail {
  return {
    subject: buildSubject(input),
    text: buildText(input, listed, opts),
    html: buildHtml(input, listed, opts),
  };
}

function buildSubject(input: DeliveryInput): string {
  const status = STATUS[input.kind];
  const base = `${status.emoji} [${input.kind}] ${input.def.slug}`;
  if (input.kind !== "firing") return base;
  const noun = input.firingCount === 1 ? "instance" : "instances";
  return `${base} — ${input.firingCount} ${noun}`;
}

function buildText(
  input: DeliveryInput,
  listed: readonly NotifiableInstance[],
  opts: BuildOptions,
): string {
  const lines: string[] = [];
  switch (input.kind) {
    case "firing":
      lines.push(input.title);
      if (input.description) lines.push("", input.description);
      lines.push("", `Alert: ${opts.url}`);
      lines.push("", `Firing instances: ${input.firingCount}`);
      break;
    case "partial_resolved":
      lines.push(`Alert: ${opts.url}`);
      lines.push("", `Resolved instances: ${listed.length}`);
      lines.push(`Still firing instances: ${input.firingCount}`);
      break;
    case "resolved": {
      lines.push(`Alert: ${opts.url}`);
      const duration = longestDuration(listed, opts.now);
      lines.push(
        "",
        duration
          ? `All instances resolved (fired for ${duration})`
          : "All instances resolved",
      );
      break;
    }
  }
  lines.push(...instanceLines(listed, input.kind, opts.now, "-"));
  lines.push("", formatUtc(opts.now));
  return lines.join("\n");
}

// Font stacks mirroring --font-sans / --font-heading and the app's code font;
// clients without the brand fonts fall back to their system equivalents.
const FONT =
  "font-family:'Inter','Segoe UI',-apple-system,Roboto,sans-serif;" as const;
const HEADING =
  "font-family:'Space Grotesk','Inter','Segoe UI',sans-serif;" as const;
const MONO =
  "font-family:source-code-pro,ui-monospace,Menlo,Consolas,monospace;" as const;

function buildHtml(
  input: DeliveryInput,
  listed: readonly NotifiableInstance[],
  opts: BuildOptions,
): string {
  const status = STATUS[input.kind];
  const sections = [
    headerSection(input, listed, opts),
    input.kind === "firing" && input.description
      ? paragraphSection(input.description)
      : "",
    statsSection(input, listed),
    instanceSection(input, listed, opts),
    ctaSection(opts.url),
    footerSection(),
  ];
  return [
    `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:8px;overflow:hidden;${FONT}">`,
    `<tr><td style="height:3px;background:${status.strip};"></td></tr>`,
    ...sections.filter(Boolean),
    "</table>",
  ].join("\n");
}

function headerSection(
  input: DeliveryInput,
  listed: readonly NotifiableInstance[],
  opts: BuildOptions,
): string {
  const status = STATUS[input.kind];
  let subhead: string;
  switch (input.kind) {
    case "firing":
      subhead = escapeHtml(input.title);
      break;
    case "partial_resolved":
      subhead = `${listed.length} resolved · ${input.firingCount} still firing`;
      break;
    case "resolved": {
      const duration = longestDuration(listed, opts.now);
      subhead = duration
        ? `All instances resolved · fired for ${duration}`
        : "All instances resolved";
      break;
    }
  }
  return `<tr><td style="padding:24px 32px 0;">
<div style="${HEADING}font-size:13px;font-weight:700;letter-spacing:0.18em;color:${COLORS.primary};margin-bottom:18px;">EVERR</div>
<span style="display:inline-block;background:${status.badgeBg};color:${status.badgeText};font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:4px 10px;border-radius:9999px;">${status.label}</span>
<h1 style="margin:12px 0 4px;font-size:20px;${MONO}color:${COLORS.foreground};">${escapeHtml(input.def.slug)}</h1>
<p style="margin:0;font-size:14px;color:${COLORS.body};">${subhead}</p>
<p style="margin:4px 0 0;font-size:12px;font-weight:600;color:${COLORS.muted};">${formatUtc(opts.now)}</p>
</td></tr>`;
}

function paragraphSection(text: string): string {
  return `<tr><td style="padding:16px 32px 0;">
<p style="margin:0;font-size:14px;line-height:1.5;color:${COLORS.body};">${escapeHtml(text)}</p>
</td></tr>`;
}

function statsSection(
  input: DeliveryInput,
  listed: readonly NotifiableInstance[],
): string {
  let cells: { label: string; value: string; color: string }[];
  switch (input.kind) {
    case "firing":
      cells = [
        {
          label: "Firing instances",
          value: String(input.firingCount),
          color: COLORS.destructiveStat,
        },
        {
          label: "New",
          value: String(listed.length),
          color: COLORS.foreground,
        },
      ];
      break;
    case "partial_resolved":
      cells = [
        {
          label: "Resolved",
          value: String(listed.length),
          color: COLORS.primary,
        },
        {
          label: "Still firing",
          value: String(input.firingCount),
          color: COLORS.destructiveStat,
        },
      ];
      break;
    case "resolved":
      return "";
  }
  const [left, right] = cells;
  return `<tr><td style="padding:20px 32px 0;">
<table cellpadding="0" cellspacing="0" width="100%" style="background:${COLORS.panel};border:1px solid ${COLORS.border};border-radius:6px;">
<tr>
<td style="padding:12px 16px;">
<div style="font-size:12px;font-weight:600;color:${COLORS.muted};">${left.label}</div>
<div style="font-size:18px;font-weight:600;${HEADING}color:${left.color};">${left.value}</div>
</td>
<td style="padding:12px 16px;text-align:right;">
<div style="font-size:12px;font-weight:600;color:${COLORS.muted};">${right.label}</div>
<div style="font-size:18px;font-weight:600;${HEADING}color:${right.color};">${right.value}</div>
</td>
</tr>
</table>
</td></tr>`;
}

function instanceSection(
  input: DeliveryInput,
  listed: readonly NotifiableInstance[],
  opts: BuildOptions,
): string {
  if (listed.length === 0) return "";
  const heading =
    input.kind === "firing" ? "New instances" : "Resolved instances";
  const detailColor =
    input.kind === "firing" ? COLORS.destructiveDetail : COLORS.muted;
  const shown = listed.slice(0, MAX_LISTED_INSTANCES);
  const rows = shown.map((instance, index) => {
    const border =
      index < shown.length - 1
        ? `border-bottom:1px solid ${COLORS.border};`
        : "";
    const detail = instanceDetail(instance, input.kind, opts.now);
    const detailCell = detail
      ? `<td style="padding:6px 0;${border}text-align:right;${MONO}color:${detailColor};font-weight:600;">${escapeHtml(detail)}</td>`
      : "";
    return `<tr><td style="padding:6px 0;${border}${MONO}color:${COLORS.foreground};">${escapeHtml(formatLabels(instance.labels))}</td>${detailCell}</tr>`;
  });
  if (listed.length > MAX_LISTED_INSTANCES) {
    rows.push(
      `<tr><td colspan="2" style="padding:6px 0;color:${COLORS.body};">… and ${listed.length - MAX_LISTED_INSTANCES} more</td></tr>`,
    );
  }
  return `<tr><td style="padding:20px 32px 0;">
<div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:${COLORS.muted};margin-bottom:8px;">${heading}</div>
<table cellpadding="0" cellspacing="0" width="100%" style="font-size:13px;color:${COLORS.body};">
${rows.join("\n")}
</table>
</td></tr>`;
}

function ctaSection(url: string): string {
  return `<tr><td style="padding:24px 32px 28px;">
<a href="${escapeHtml(url)}" style="display:inline-block;background:${COLORS.primary};color:${COLORS.primaryForeground};font-size:14px;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:6px;">View alert</a>
</td></tr>`;
}

function footerSection(): string {
  return `<tr><td style="padding:16px 32px;border-top:1px solid ${COLORS.border};">
<p style="margin:0;font-size:12px;color:${COLORS.muted};">Everr · You receive this because alert emails are enabled for your organization.</p>
</td></tr>`;
}
