import { Link } from "@tanstack/react-router";
import { alertingSloIdentity } from "@/data/alerting/slo";
import type { AlertingExhaustedBudget } from "@/data/alerting/triage";
import { AlertingBudgetFact } from "./budget-bar";
import { SectionCard } from "./shared";

export function AlertingExhaustedBudgetsCard({
  items,
}: {
  /** Spent budgets, worst first (alertingExhaustedBudgets). */
  items: AlertingExhaustedBudget[];
}) {
  if (items.length === 0) return null;
  return (
    <SectionCard
      title="Exhausted error budgets"
      linkLabel="All SLOs"
      to="/alerts/slos"
    >
      <div className="divide-y divide-border/60">
        {items.map(({ slo, status }) => {
          // One identity derivation for both link params and name, so they
          // cannot diverge.
          const identity = alertingSloIdentity(slo);
          return (
            <Link
              key={slo.id}
              to="/alerts/slos/$project/$slug"
              params={{ project: identity.project, slug: identity.slug }}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-primary"
            >
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-xs font-medium text-foreground">
                  {identity.name}
                </span>
              </span>
              <AlertingBudgetFact remaining={status.budget_remaining} />
            </Link>
          );
        })}
      </div>
    </SectionCard>
  );
}
