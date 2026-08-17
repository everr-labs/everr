import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { RelativeTime } from "@everr/ui/components/relative-time";
import type { Tone } from "@everr/ui/components/tone";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { alertingRuleIdentity } from "@/data/alerting/rules/identity";
import { ruleQueries } from "@/data/alerting/rules/queries";
import { formatDurationSeconds } from "@/data/alerting/rules/resource/window";
import {
  pauseAlertingRule,
  resumeAlertingRule,
} from "@/data/alerting/rules/server";
import type { AlertingRuleView } from "@/data/alerting/types";
import {
  AlertingEmptyState,
  AlertingPauseToggle,
  AlertingRunbookLink,
  AlertingTableSkeleton,
  alertingErrorMessage,
  alertingFormatTs,
} from "../shared/components";
import {
  AlertingHealthHeart,
  AlertingSeverityBadge,
  AlertingStatusLabel,
} from "../shared/status";

/** How many quiet rules render before Load more. */
export const QUIET_RULES_PAGE = 50;

/**
 * A quiet rule has no firing or pending instance, so it has no rows to show.
 * `rollup` is always present on the view (see `ruleView` in the rules
 * repository), so there is no "not reported" case to carry here.
 */
function quietStatus(rule: AlertingRuleView): {
  label: string;
  tone: Tone;
  muted?: boolean;
} {
  if (rule.paused) return { label: "Paused", tone: "muted" };
  if (rule.previewId !== null) return { label: "Preview", tone: "muted" };
  if (rule.health.status === "degraded") {
    return { label: "Degraded", tone: "warning" };
  }
  return { label: "OK", tone: "healthy", muted: true };
}

function QuietRuleLine({ rule }: { rule: AlertingRuleView }) {
  const qc = useQueryClient();
  const identity = alertingRuleIdentity(rule);
  const status = quietStatus(rule);
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          to="/alerts/rules/$project/$slug"
          params={{ project: identity.project, slug: identity.slug }}
          className="min-w-0 text-sm font-medium text-foreground underline-offset-2 hover:underline"
        >
          {identity.name}
        </Link>
        <AlertingHealthHeart status={rule.health.status} />
        {rule.spec.severity !== "info" && (
          <AlertingSeverityBadge severity={rule.spec.severity} />
        )}
        <span className="text-[0.6875rem] text-muted-foreground">
          Every {formatDurationSeconds(rule.spec.interval_secs)}
        </span>
      </span>
      <AlertingStatusLabel
        tone={status.tone}
        muted={status.muted}
        className="w-24 text-xs"
      >
        {status.label}
      </AlertingStatusLabel>
      <span className="w-24 text-xs text-muted-foreground">
        {rule.rollup.last_fired_at ? (
          <RelativeTime
            timestamp={rule.rollup.last_fired_at}
            title={alertingFormatTs(rule.rollup.last_fired_at)}
          />
        ) : (
          "never fired"
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {identity.runbook ? (
          <AlertingRunbookLink {...identity.runbook} name={identity.name} />
        ) : null}
        <AlertingPauseToggle
          paused={rule.paused}
          pending={toggle.isPending}
          kind="alert rule"
          name={identity.name}
          onToggle={() => toggle.mutate()}
        />
      </span>
    </div>
  );
}

export function QuietRulesCard({
  rules,
  totalRules,
  pending,
}: {
  rules: AlertingRuleView[];
  /** Every rule the tenant has, board and quiet band combined. Distinguishes
   *  "no rules defined" from "every rule is on the board above", which read
   *  as the same empty list otherwise. */
  totalRules: number;
  pending: boolean;
}) {
  const [visible, setVisible] = useState(QUIET_RULES_PAGE);
  const shown = rules.slice(0, visible);
  const remaining = rules.length - shown.length;

  return (
    <Card
      inset="flush-content"
      role="region"
      aria-label="Quiet rules"
      aria-busy={pending}
    >
      <CardHeader className="border-b border-border/60 py-2">
        <CardTitle>
          <h2>Quiet rules</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pending ? (
          <AlertingTableSkeleton rows={5} />
        ) : rules.length === 0 ? (
          totalRules === 0 ? (
            <AlertingEmptyState
              icon={SlidersHorizontal}
              title="No quiet rules"
              hint={
                <>
                  Define alerting rules as code and apply them with{" "}
                  <code>everr apply</code>.
                </>
              }
            />
          ) : (
            <AlertingEmptyState
              icon={SlidersHorizontal}
              title="No quiet rules"
              hint="Every rule has a firing or pending instance. See Active alerts above."
            />
          )
        ) : (
          <>
            <div className="divide-y divide-border/60">
              {shown.map((rule) => (
                <QuietRuleLine key={rule.id} rule={rule} />
              ))}
            </div>
            {remaining > 0 && (
              <div className="flex items-center justify-center gap-2 px-3 py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisible((n) => n + QUIET_RULES_PAGE)}
                >
                  Load more
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {remaining} more of {rules.length}
                </span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
