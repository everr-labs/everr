import { Button } from "@everr/ui/components/button";
import { Card, CardContent, CardHeader } from "@everr/ui/components/card";
import { RelativeTime } from "@everr/ui/components/relative-time";
import type { Tone } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { alertingRuleIdentity } from "@/data/alerting/rules/identity";
import { ruleQueries } from "@/data/alerting/rules/queries";
import {
  pauseAlertingRule,
  resumeAlertingRule,
} from "@/data/alerting/rules/server";
import type { AlertingRuleView } from "@/data/alerting/types";
import { alertingFormatTs } from "../common/format";
import { AlertingRunbookLink } from "../common/navigation";
import { AlertingPauseToggle } from "../common/pause-toggle";
import {
  AlertingEmptyState,
  AlertingTableSkeleton,
} from "../common/placeholders";
import { alertingErrorMessage } from "../common/query-error";
import { AlertingRuleIdentity } from "../common/rule-identity";
import { SectionHeading } from "../common/section-heading";
import { AlertingStatusLabel } from "../common/status";
import { AlertingSummaryLabel } from "../common/summary-card";

/** How many rules render before Load more. */
export const RULES_PAGE = 50;

/**
 * `rollup` is always present on the view (see `ruleView` in the rules
 * repository), so there is no "not reported" case to carry here.
 */
function ruleStatus(
  rule: AlertingRuleView,
  firing: boolean,
  pending: boolean,
): { label: string; tone: Tone; muted: boolean } {
  // A rule the preview deleted is shown from its live row, and this page's
  // instances are the preview's. Without this the column would read "OK" for a
  // rule firing on live right now.
  if (rule.previewStatus === "removed")
    return { label: "Removed", tone: "muted", muted: true };
  if (rule.paused) return { label: "Paused", tone: "muted", muted: true };
  // Firing and pending outrank health. A degraded rule that is also firing is
  // a firing rule, and the reader acts on the alert, not on the evaluation
  // error. Firing outranks pending, never the reverse: Triage separates the
  // two, so this list must not fold them into one label.
  if (firing) return { label: "Firing", tone: "danger", muted: false };
  if (pending) return { label: "Pending", tone: "warning", muted: false };
  if (rule.health.status === "degraded") {
    return { label: "Degraded", tone: "warning", muted: false };
  }
  return { label: "OK", tone: "healthy", muted: true };
}

function RuleLine({
  rule,
  firing,
  pending,
}: {
  rule: AlertingRuleView;
  firing: boolean;
  pending: boolean;
}) {
  const qc = useQueryClient();
  const identity = alertingRuleIdentity(rule);
  const status = ruleStatus(rule, firing, pending);
  const toggle = useMutation({
    mutationFn: () =>
      rule.paused
        ? resumeAlertingRule({ data: { ruleId: rule.id } })
        : pauseAlertingRule({ data: { ruleId: rule.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ruleQueries.rulesFamily });
      toast.success("Rule updated");
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
  });

  return (
    <li
      aria-label={identity.name}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2",
        rule.previewStatus === "removed" && "opacity-50",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <AlertingRuleIdentity
          name={identity.name}
          params={{ project: identity.project, slug: identity.slug }}
          previewStatus={rule.previewStatus}
          healthStatus={rule.health.status}
          severity={rule.spec.severity}
          intervalSecs={rule.spec.interval_secs}
        />
      </span>
      <span className="flex w-24 shrink-0 flex-col">
        <AlertingSummaryLabel>status</AlertingSummaryLabel>
        <AlertingStatusLabel
          tone={status.tone}
          muted={status.muted}
          className="text-xs"
        >
          {status.label}
        </AlertingStatusLabel>
      </span>
      <span className="flex w-24 shrink-0 flex-col">
        <AlertingSummaryLabel>last fired</AlertingSummaryLabel>
        <span className="text-xs text-muted-foreground">
          {rule.rollup.last_fired_at ? (
            <RelativeTime
              timestamp={rule.rollup.last_fired_at}
              title={alertingFormatTs(rule.rollup.last_fired_at)}
            />
          ) : (
            "never fired"
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {identity.runbook ? (
          <AlertingRunbookLink {...identity.runbook} name={identity.name} />
        ) : null}
        <AlertingPauseToggle
          paused={rule.paused}
          pending={toggle.isPending}
          name={identity.name}
          onToggle={() => toggle.mutate()}
        />
      </span>
    </li>
  );
}

export function AlertingRulesCard({
  rules,
  firingRuleIds,
  pendingRuleIds,
  pending,
}: {
  rules: AlertingRuleView[];
  /** Which rules have a firing instance right now, keyed by rule id. */
  firingRuleIds: Set<string>;
  /** Which rules have a pending (not yet firing) instance right now, keyed
   *  by rule id. Disjoint from `firingRuleIds`: an instance is one or the
   *  other, never both. */
  pendingRuleIds: Set<string>;
  /** Whether the rules query itself is still loading. */
  pending: boolean;
}) {
  const [visible, setVisible] = useState(RULES_PAGE);
  // Alphabetical by display name: this list is read by hunting for a rule
  // you can name, not by internal update order.
  const sorted = [...rules].sort((a, b) =>
    alertingRuleIdentity(a).name.localeCompare(alertingRuleIdentity(b).name),
  );
  const shown = sorted.slice(0, visible);
  const remaining = sorted.length - shown.length;

  return (
    <Card
      inset="flush-content"
      role="region"
      aria-label="All rules"
      aria-busy={pending}
    >
      <CardHeader className="border-b border-border/60 py-2">
        <SectionHeading>All rules</SectionHeading>
      </CardHeader>
      <CardContent>
        {pending ? (
          <AlertingTableSkeleton rows={5} />
        ) : sorted.length === 0 ? (
          <AlertingEmptyState
            icon={SlidersHorizontal}
            title="No rules"
            hint={
              <>
                Define alerting rules as code and apply them with{" "}
                <code>everr apply</code>.
              </>
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-border/60">
              {shown.map((rule) => (
                <RuleLine
                  key={rule.id}
                  rule={rule}
                  firing={firingRuleIds.has(rule.id)}
                  pending={pendingRuleIds.has(rule.id)}
                />
              ))}
            </ul>
            {remaining > 0 && (
              <div className="flex items-center justify-center gap-2 px-3 py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisible((n) => n + RULES_PAGE)}
                >
                  Load more
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {remaining} more of {sorted.length}
                </span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
