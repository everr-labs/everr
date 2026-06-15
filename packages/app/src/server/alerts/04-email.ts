import { formatLabels } from "@/data/alerts/matchers";
import {
  type BuildOptions,
  type DeliveryInput,
  type DeliveryKind,
  escapeHtml,
  formatDuration,
  formatUtc,
  instanceDetail,
  instanceLine,
  KIND_STATUS,
} from "./04-format";

export interface AlertEmail {
  subject: string;
  text: string;
  html: string;
}

// Hex equivalents of the oklch theme tokens in packages/ui global.css — the
// app ships a single dark theme, and the email mirrors it: a gray --card sits
// on the slightly darker --background, rather than pure black. Text colors are
// the theme's light foreground/muted tokens, which keep running text, the
// small bold labels, and the stat numbers comfortably legible on the gray card.
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
  resolved: {
    ...KIND_STATUS.resolved,
    strip: COLORS.primary,
    badgeText: COLORS.primary, // Lc -94 on the badge bg
    badgeBg: "#262b0a",
  },
};

export function buildAlertEmail(
  input: DeliveryInput,
  opts: BuildOptions,
): AlertEmail {
  return {
    subject: buildSubject(input),
    text: buildText(input, opts),
    html: buildHtml(input, opts),
  };
}

function buildSubject(input: DeliveryInput): string {
  const status = STATUS[input.kind];
  const label = formatLabels(input.instance.labels);
  return `${status.emoji} [${input.kind}] ${input.def.slug} — ${label}`;
}

function buildText(input: DeliveryInput, opts: BuildOptions): string {
  const lines: string[] = [];
  if (input.kind === "firing") {
    lines.push(input.title);
    if (input.description) lines.push("", input.description);
  } else {
    const duration = input.instance.firedAt
      ? formatDuration(input.instance.firedAt, opts.now)
      : "";
    lines.push(
      duration
        ? `Instance resolved (fired for ${duration})`
        : "Instance resolved",
    );
  }
  lines.push("", instanceLine(input.instance, input.kind, opts.now, "-"));
  lines.push("", `Alert: ${opts.url}`);
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

function buildHtml(input: DeliveryInput, opts: BuildOptions): string {
  const status = STATUS[input.kind];
  const sections = [
    headerSection(input, opts),
    input.kind === "firing" && input.description
      ? paragraphSection(input.description)
      : "",
    instanceSection(input, opts),
    ctaSection(opts.url),
    footerSection(),
  ];
  return [
    `<table width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.panel};${FONT}"><tr><td style="padding:0;">`,
    `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:8px;overflow:hidden;">`,
    `<tr><td style="height:3px;background:${status.strip};"></td></tr>`,
    ...sections.filter(Boolean),
    "</table>",
    "</td></tr></table>",
  ].join("\n");
}

function headerSection(input: DeliveryInput, opts: BuildOptions): string {
  const status = STATUS[input.kind];
  let subhead: string;
  if (input.kind === "firing") {
    subhead = escapeHtml(input.title);
  } else {
    const duration = input.instance.firedAt
      ? formatDuration(input.instance.firedAt, opts.now)
      : "";
    subhead = duration
      ? `Instance resolved · fired for ${duration}`
      : "Instance resolved";
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

function instanceSection(input: DeliveryInput, opts: BuildOptions): string {
  const heading = input.kind === "firing" ? "Instance" : "Resolved instance";
  const detailColor =
    input.kind === "firing" ? COLORS.destructiveDetail : COLORS.muted;
  const detail = instanceDetail(input.instance, input.kind, opts.now);
  const detailCell = detail
    ? `<td style="padding:6px 0;text-align:right;${MONO}color:${detailColor};font-weight:600;">${escapeHtml(detail)}</td>`
    : "";
  const row = `<tr><td style="padding:6px 0;${MONO}color:${COLORS.foreground};">${escapeHtml(formatLabels(input.instance.labels))}</td>${detailCell}</tr>`;
  return `<tr><td style="padding:20px 32px 0;">
<div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:${COLORS.muted};margin-bottom:8px;">${heading}</div>
<table cellpadding="0" cellspacing="0" width="100%" style="font-size:13px;color:${COLORS.body};">
${row}
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
