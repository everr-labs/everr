import { Badge } from "@everr/ui/components/badge";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { alertingRuleIdentity } from "@/data/alerting/rules/identity";
import { ruleQueries } from "@/data/alerting/rules/queries";
import {
  alertingIsCatchAll,
  alertingOpSymbol,
} from "@/data/alerting/silences/matching";
import type { AlertingMatcher } from "@/data/alerting/types";

function Pill({
  className,
  title,
  children,
}: {
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none",
        className,
      )}
    >
      {children}
    </span>
  );
}

type AlertingMatcherValueLink = {
  text: string;
  to: "/alerts/rules/$project/$slug";
  params: { project: string; slug: string };
};

function useAlertingMatcherValueLink(): (
  m: AlertingMatcher,
) => AlertingMatcherValueLink | null {
  const rules = useQuery(ruleQueries.rules());
  return useMemo(() => {
    const byId = new Map<string, AlertingMatcherValueLink>();
    for (const rule of rules.data ?? []) {
      const identity = alertingRuleIdentity(rule);
      byId.set(rule.id, {
        text: identity.name,
        to: "/alerts/rules/$project/$slug",
        params: { project: identity.project, slug: identity.slug },
      });
    }
    return (matcher: AlertingMatcher) =>
      matcher.label === "rule" ? (byId.get(matcher.value) ?? null) : null;
  }, [rules.data]);
}

export function Matchers({
  matchers,
  emptyLabel = "*",
}: {
  matchers: AlertingMatcher[];
  emptyLabel?: string;
}) {
  const resolveValue = useAlertingMatcherValueLink();
  if (alertingIsCatchAll(matchers)) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        {emptyLabel}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {matchers.map((matcher, index) => {
        const link = resolveValue(matcher);
        return (
          <Pill key={index}>
            <span className="text-foreground">{matcher.label}</span>
            <span className="text-muted-foreground">
              {alertingOpSymbol(matcher.op)}
            </span>
            {link ? (
              <Link
                to={link.to}
                params={link.params}
                title={matcher.value}
                className="text-foreground underline-offset-2 hover:underline"
              >
                {link.text}
              </Link>
            ) : (
              <span className="text-foreground">{matcher.value}</span>
            )}
          </Pill>
        );
      })}
    </span>
  );
}

export function LabelSet({
  labels,
  emptyLabel = "—",
}: {
  labels: Record<string, string>;
  emptyLabel?: string;
}) {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">{emptyLabel}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {entries.map(([key, value]) => (
        <Pill key={key}>
          <span className="text-muted-foreground">{key}</span>
          <span className="text-muted-foreground/60">=</span>
          <span className="text-foreground">{value}</span>
        </Pill>
      ))}
    </span>
  );
}

function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function EvidenceChips({
  evidence,
  truncated,
}: {
  evidence: Record<string, unknown> | null | undefined;
  truncated?: boolean;
}) {
  const entries = evidence
    ? Object.entries(evidence)
        .map(([key, value]) => [key, formatEvidenceValue(value)] as const)
        .sort(([a], [b]) => a.localeCompare(b))
    : [];
  if (entries.length === 0 && !truncated) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {entries.map(([key, value]) => (
        <Badge key={key} variant="secondary" className="font-mono font-normal">
          {key}={value}
        </Badge>
      ))}
      {truncated && (
        <span className="text-xs text-muted-foreground">
          evidence truncated
        </span>
      )}
    </div>
  );
}
