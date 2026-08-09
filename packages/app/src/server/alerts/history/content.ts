const SERVICE_LABEL_RE = /^service([_-]?name)?$/i;

export const ALERT_LABEL_KEY_MAX = 256;
export const ALERT_LABEL_VALUE_MAX = 1024;

/**
 * Hard length cap per label key and value at the write boundary, matching the
 * matcher bounds. Truncates rather than drops: a shortened label still joins
 * its history; a missing one silently breaks the chain.
 */
export function capAlertLabels(
  labels: Record<string, string>,
): Record<string, string> {
  const capped: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    capped[key.slice(0, ALERT_LABEL_KEY_MAX)] = value.slice(
      0,
      ALERT_LABEL_VALUE_MAX,
    );
  }
  return capped;
}

/** The rule-level service fallback: the `everr.service` annotation. */
export function alertServiceFallback(
  annotations: Record<string, string | undefined>,
): string {
  return annotations["everr.service"] ?? "alert";
}

/**
 * The service an alert row concerns, resolved at write time: an instance
 * label naming a service wins (per instance, so a rule grouped by service
 * gets one value per firing instance), then the rule-level fallback, then the
 * `alert` marker. Write-time resolution is what lets the `app.logs`
 * projection group alert rows with the service they describe.
 */
export function resolveAlertServiceName(
  labels: Record<string, string>,
  fallback: string,
): string {
  const candidates = Object.keys(labels)
    .filter((key) => SERVICE_LABEL_RE.test(key) && labels[key] !== "")
    .sort((a, b) => {
      if (a.toLowerCase() === "service") return -1;
      if (b.toLowerCase() === "service") return 1;
      return a.localeCompare(b);
    });
  const chosen = candidates[0];
  if (chosen !== undefined) return labels[chosen];
  return fallback === "" ? "alert" : fallback;
}

const URL_RE = /\b(?:https?|wss?):\/\/[^\s"'<>)\]]+/gi;
const BARE_WEBHOOK_HOST_RE =
  /\b(?:hooks\.slack\.com|discord\.com\/api\/webhooks|api\.telegram\.org)\/[^\s"'<>)\]]*/gi;
const BOT_TOKEN_RE = /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g;

/**
 * Provider error text can embed the webhook URL, which for Slack, Discord and
 * Telegram IS the secret, and the table is append-only: a secret written to
 * the `error` column cannot be withdrawn. Strip anything URL- or token-shaped
 * before it reaches an insert.
 */
export function sanitizeAlertError(text: string): string {
  return text
    .replace(URL_RE, "[redacted-url]")
    .replace(BARE_WEBHOOK_HOST_RE, "[redacted-url]")
    .replace(BOT_TOKEN_RE, "[redacted-token]");
}

/**
 * The frozen agent-facing content of a transition row: what the notification
 * says, where to pivot, and what the condition was. Read-out facts, never
 * predicates, so they travel as one opaque JSON column with documented keys
 * (`{summary, description, links: {runbook, alert}, condition}`).
 */
export function buildAlertContextJson(opts: {
  summary: string | undefined;
  description: string | undefined;
  alertLink: string | undefined;
  runbookLink: string | undefined;
  condition: { operator: string; threshold: number; value: number | null };
}): string {
  const links: Record<string, string> = {};
  if (opts.alertLink) links.alert = opts.alertLink;
  if (opts.runbookLink) links.runbook = opts.runbookLink;
  return JSON.stringify({
    ...(opts.summary ? { summary: opts.summary } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(Object.keys(links).length > 0 ? { links } : {}),
    condition: opts.condition,
  });
}
