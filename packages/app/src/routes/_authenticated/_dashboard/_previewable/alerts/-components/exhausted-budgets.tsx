import { Link } from "@tanstack/react-router";
import { ccSloIdentity } from "@/data/cc/slo";
import type { CcExhaustedBudget } from "@/data/cc/triage";
import { CcBudgetBar } from "./budget-bar";
import { LabelSet, SectionCard } from "./shared";

export function CcExhaustedBudgetsCard({
  items,
}: {
  /** Spent budgets, worst first (ccExhaustedBudgets). */
  items: CcExhaustedBudget[];
}) {
  if (items.length === 0) return null;
  return (
    <SectionCard
      title="Exhausted error budgets"
      linkLabel="All SLOs"
      to="/alerts/slos"
    >
      <div className="divide-y divide-border/60">
        {items.map(({ slo, group }) => {
          // One identity derivation for both link params and name, so they
          // cannot diverge.
          const identity = ccSloIdentity(slo);
          return (
            <Link
              key={`${slo.id}|${JSON.stringify(group.labels)}`}
              to="/alerts/slos/$project/$slug"
              params={{ project: identity.project, slug: identity.slug }}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-primary"
            >
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-xs font-medium text-foreground">
                  {identity.name}
                </span>
                {Object.keys(group.labels).length > 0 && (
                  <LabelSet labels={group.labels} />
                )}
              </span>
              <CcBudgetBar
                remaining={group.budget_remaining}
                className="w-24 shrink-0"
              />
            </Link>
          );
        })}
      </div>
    </SectionCard>
  );
}
