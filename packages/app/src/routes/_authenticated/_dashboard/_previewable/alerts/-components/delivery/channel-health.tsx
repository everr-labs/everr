import { RelativeTime } from "@everr/ui/components/relative-time";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import {
  ALERTING_CHANNEL_HEALTH_HOURS,
  type AlertingChannelHealth,
} from "@/data/alerting/delivery/health";

/**
 * The head of a provider error. A refusing endpoint often answers with a whole
 * HTML page, and the row states a fact rather than reprinting the response;
 * the full text stays on the element's title.
 */
function errorExcerpt(error: string): string {
  const firstLine = error.split("\n")[0] ?? error;
  // A refusing endpoint often answers with a whole page; the status line in
  // front of it is the part that names the problem.
  const markupAt = firstLine.search(/<[a-zA-Z!/]/);
  const prose = (
    markupAt > 0 ? firstLine.slice(0, markupAt) : firstLine
  ).trim();
  return prose.length > 90 ? `${prose.slice(0, 90)}...` : prose;
}

/**
 * What the last day of real deliveries says about one channel.
 *
 * Silent when the channel has not been used: an unused channel is a
 * configuration fact, and the receiver usage line beside this one already
 * states it. This line only ever reports sends that were actually attempted.
 */
export function ChannelHealthLine({
  health,
}: {
  health: AlertingChannelHealth | undefined;
}) {
  if (!health || health.delivered + health.failed === 0) return null;

  const window = `${ALERTING_CHANNEL_HEALTH_HOURS}h`;
  const broken = health.failed > 0 && health.delivered === 0;
  const tone = broken ? "danger" : health.failed > 0 ? "warning" : "muted";
  const Icon = health.failed > 0 ? TriangleAlert : CheckCircle2;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-xs",
        toneText({ tone }),
      )}
      title={health.lastError || undefined}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {health.failed > 0 ? (
        <span className="min-w-0 truncate">
          {health.delivered === 0
            ? `${health.failed} ${health.failed === 1 ? "delivery" : "deliveries"} failed in ${window}`
            : `${health.failed} of ${health.failed + health.delivered} deliveries failed in ${window}`}
          {health.lastError ? `: ${errorExcerpt(health.lastError)}` : ""}
        </span>
      ) : (
        <span className="min-w-0 truncate">
          Delivered{" "}
          {health.lastSuccessAt && (
            <RelativeTime
              timestamp={health.lastSuccessAt}
              title={health.lastSuccessAt}
            />
          )}
          {health.delivered > 1 ? ` · ${health.delivered} in ${window}` : ""}
        </span>
      )}
    </span>
  );
}
