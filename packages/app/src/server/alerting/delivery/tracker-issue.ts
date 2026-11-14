import { truncateWithEllipsis } from "#app/lib/truncate.ts";

// GitHub's own limits: 256 characters for a title, 65536 for a body or a
// comment. The body keeps a margin so the footer always fits.
const TITLE_MAX = 256;
const BODY_MAX = 60_000;
const EVIDENCE_VALUE_MAX = 2_000;
const BLOCK_MAX = 8_000;

export type TrackerIssueInput = {
  /** The rule's `project/slug`. */
  rulePath: string;
  ruleName: string;
  severity: string;
  /** The rendered `summary` annotation, empty when the rule has none. */
  title: string;
  /** The rendered `description` annotation, empty when the rule has none. */
  description: string;
  labels: Record<string, string>;
  evidence: Record<string, unknown>;
  occurredAt: Date;
  alertLink?: string;
  runbookLink?: string;
};

function labelText(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

// Evidence values are telemetry, so they can hold anything. Inline code keeps
// markdown inert; a backtick inside the value would end the span early, so
// the fence grows past the longest run in the value.
function inlineCode(value: string): string {
  const longestRun = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  const padded = value.startsWith("`") || value.endsWith("`") ? ` ${value} ` : value;
  return `${fence}${padded}${fence}`;
}

function cell(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return inlineCode(
    truncateWithEllipsis(text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|"), EVIDENCE_VALUE_MAX),
  );
}

function isMultiline(value: unknown): value is string {
  return typeof value === "string" && /\r?\n/.test(value.trim());
}

// Fenced past the longest backtick run, for the same reason as inlineCode.
function codeBlock(value: string): string {
  const longestRun = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${truncateWithEllipsis(value.trimEnd(), BLOCK_MAX)}\n${fence}`;
}

export function trackerIssueTitle(input: TrackerIssueInput): string {
  const labels = labelText(input.labels);
  const title = input.title || (labels ? `${input.ruleName}: ${labels}` : input.ruleName);
  return truncateWithEllipsis(title.replace(/\s+/g, " ").trim(), TITLE_MAX);
}

/** What the alert says right now: the description, facts, evidence and
 *  links. The issue body and a recurrence comment both lead with it. */
function trackerIssueDetails(input: TrackerIssueInput): string {
  const sections: string[] = [];
  if (input.description) sections.push(input.description);

  const facts = [
    `**Alert rule:** ${inlineCode(input.rulePath)} (${input.ruleName})`,
    `**Severity:** ${input.severity}`,
    `**Fired at:** ${input.occurredAt.toISOString()}`,
  ];
  const labels = labelText(input.labels);
  if (labels) facts.push(`**Labels:** ${inlineCode(labels)}`);
  sections.push(facts.join("\n"));

  // An empty column says nothing. A multi-line one, like a stack trace,
  // reads only with its line breaks, so it gets a block of its own.
  const evidence = Object.entries(input.evidence).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  const blocks = evidence.filter(([, value]) => isMultiline(value));
  const rows = evidence.filter(([, value]) => !isMultiline(value));
  if (rows.length > 0) {
    sections.push(
      [
        "### Evidence",
        "",
        "| Column | Value |",
        "| --- | --- |",
        ...rows.map(([key, value]) => `| ${cell(key)} | ${cell(value)} |`),
      ].join("\n"),
    );
  }
  for (const [key, value] of blocks) {
    sections.push(`### ${cell(key)}\n\n${codeBlock(String(value))}`);
  }

  const links = [
    input.alertLink ? `[Open the alert in Everr](${input.alertLink})` : "",
    input.runbookLink ? `[Runbook](${input.runbookLink})` : "",
  ].filter(Boolean);
  if (links.length > 0) sections.push(links.join(" · "));
  return truncateWithEllipsis(sections.join("\n\n"), BODY_MAX);
}

export function trackerIssueBody(input: TrackerIssueInput): string {
  const footer = [
    "---",
    "Opened by Everr from a firing alert. Investigate it with the Everr CLI or MCP server,",
    "and confirm a fix locally: run the code against `everr local start` and check its",
    "telemetry with `everr local query`. If it cannot be fixed in code, say why in a",
    "comment instead of opening a pull request.",
  ].join("\n");

  return `${trackerIssueDetails(input)}\n\n${footer}`;
}

export function trackerRefiredComment(input: TrackerIssueInput): string {
  return `Fired again at ${input.occurredAt.toISOString()}.\n\n${trackerIssueDetails(input)}`;
}

export function trackerResolvedComment(occurredAt: Date): string {
  return `Stopped firing at ${occurredAt.toISOString()}. The issue stays open: the alert can resolve without a fix.`;
}
