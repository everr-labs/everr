// The freshest stored events, so "what just happened" is one glance (and
// History is one click) away. A preview of /alerts/history, scoped to the
// alerting layout's fixed 24h window.
import { RelativeTime } from "@everr/ui/components/relative-time";
import { Skeleton } from "@everr/ui/components/skeleton";
import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  CcEventStatusBadge,
  ccErrorMessage,
  ccFormatTs,
  SectionCard,
} from "@/components/cc/shared";
import { ccEventStatus } from "@/data/alerts/event-types";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import { ccRuleHandleResolvers } from "@/data/alerts/rule-identity";
import { parseResourceName } from "@/data/as-code/identity";
import { ccSloHandleResolver, ccSloIdentity } from "@/data/cc/slo";
import type { CcRuleView, CcSlo } from "@/data/cc/types";

export function CcRecentEventsCard({
  events,
  slos,
  rules,
}: {
  events: UseQueryResult<AlertEventLogRow[]>;
  slos: CcSlo[];
  rules: CcRuleView[];
}) {
  const resolveSlo = useMemo(() => ccSloHandleResolver(slos), [slos]);
  // Event rows carry a source handle (slug or uuid) for rules and SLOs alike;
  // the shared resolvers map either to a display name.
  const { resolveRuleName, resolveRuleAddress } = useMemo(
    () => ccRuleHandleResolvers(rules),
    [rules],
  );

  return (
    <SectionCard title="Recent events" linkLabel="History" to="/alerts/history">
      {events.isPending ? (
        <div className="space-y-2 px-3 py-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      ) : events.isError ? (
        // A failed history read is not "no events": saying so would be a false
        // all-clear on the landing page.
        <p className="px-3 pt-1 pb-3 text-xs text-destructive">
          Event history unavailable ({ccErrorMessage(events.error)}).
        </p>
      ) : (events.data ?? []).length === 0 ? (
        <p className="px-3 pt-1 pb-3 text-xs text-muted-foreground">
          No stored events in the last 24h.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {(events.data ?? []).map((e) => {
            const status = ccEventStatus(e.eventType);
            const slo = resolveSlo(e.slug);
            const ruleAddress = slo ? undefined : resolveRuleAddress(e.slug);
            const name = slo
              ? ccSloIdentity(slo).name
              : resolveRuleName(e.slug);
            return (
              <li
                key={`${e.timestamp}-${e.eventType}-${e.instanceFingerprint}`}
                className="flex items-center gap-2.5 px-3 py-1.5 text-xs"
              >
                <span
                  className="w-16 shrink-0 text-muted-foreground tabular-nums"
                  title={ccFormatTs(e.timestamp)}
                >
                  <RelativeTime timestamp={e.timestamp} />
                </span>
                <span className="w-20 shrink-0">
                  {status !== null ? (
                    <CcEventStatusBadge status={status} />
                  ) : (
                    <span className="text-muted-foreground">
                      {e.eventType.replace("_", " ")}
                    </span>
                  )}
                </span>
                {/* A resolved source links to where you act on it — the feed's
                    contract with the rest of the page. */}
                {slo ? (
                  <Link
                    to="/alerts/slos/$project/$slug"
                    params={parseResourceName(slo.name)}
                    className="min-w-0 flex-1 truncate text-foreground underline-offset-2 hover:underline"
                  >
                    {name}
                  </Link>
                ) : ruleAddress ? (
                  <Link
                    to="/alerts/rules/$project/$slug"
                    params={ruleAddress}
                    className="min-w-0 flex-1 truncate text-foreground underline-offset-2 hover:underline"
                  >
                    {name}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {name}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
