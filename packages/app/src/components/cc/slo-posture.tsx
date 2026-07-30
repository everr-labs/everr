// Error-budget posture, one row per SLO, showing its worst group: the budget
// bar, the current burn, how long the budget lasts at that burn, and any tier
// firing right now. Every row links to the SLO's detail page.
import { Skeleton } from "@everr/ui/components/skeleton";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { CcBudgetBar, ccFmtBurn } from "@/components/cc/budget-bar";
import { CcSloTierBadge, SectionCard } from "@/components/cc/shared";
import {
  ccFmtWindowLabel,
  ccFormatSloTarget,
  ccSloCurrentBurn,
  ccSloExhaustion,
  ccSloIdentity,
  ccSloTierSeverity,
  ccSloTiers,
  ccSloWindowLabel,
} from "@/data/cc/slo";
import type { CcSlo, CcSloGroupStatus, CcSloTier } from "@/data/cc/types";

export type CcSloPosture = {
  slo: CcSlo;
  statusPending: boolean;
  worst: CcSloGroupStatus | null;
  firing: { tier: string; severity: string }[];
};

export function firingTiersOf(
  tiers: readonly CcSloTier[],
  groups: CcSloGroupStatus[],
): { tier: string; severity: string }[] {
  const byName = new Map<string, string>();
  for (const g of groups) {
    for (const f of g.firing_tiers) {
      byName.set(f.tier, ccSloTierSeverity(tiers, { slo_tier: f.tier }));
    }
  }
  return [...byName].map(([tier, severity]) => ({ tier, severity }));
}

function SloPostureRow({ slo, worst, firing, statusPending }: CcSloPosture) {
  const tiers = ccSloTiers(slo.spec);
  const burn = worst ? ccSloCurrentBurn(tiers, worst.tiers) : null;
  // The same helper the SLO detail page uses, so both surfaces say the same
  // words for the same state instead of diverging on the non-forecast cases.
  const exhaustion = worst
    ? ccSloExhaustion(
        worst.budget_remaining,
        worst.time_to_exhaustion_secs,
        burn?.effective ?? null,
      )
    : null;
  const identity = ccSloIdentity(slo);
  return (
    <Link
      to="/alerts/slos/$project/$slug"
      params={{ project: identity.project, slug: identity.slug }}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-2 outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-primary"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-foreground">
          {identity.name}
        </span>
        <span className="text-[0.6875rem] whitespace-nowrap text-muted-foreground">
          {ccFormatSloTarget(slo.spec.targetPercent)} over{" "}
          {ccSloWindowLabel(slo.spec)}
        </span>
      </span>
      {/* The metrics sit in one fixed-width slot (24 + 20 + 24 plus the two
          gaps) rather than as three loose flex children. Loose children let the
          variable-width tier badges below steal slack from the flex-1 name
          column by a different amount on every row, which slid the numbers out
          of column with each other. */}
      <span className="flex w-76 shrink-0 items-center justify-end gap-x-4">
        {statusPending ? (
          <Skeleton className="h-4 w-40" />
        ) : worst === null ? (
          <span className="text-xs text-muted-foreground">no snapshot yet</span>
        ) : (
          <>
            {/* A flex row, so the bar's width is set here rather than inside it. */}
            <CcBudgetBar
              remaining={worst.budget_remaining}
              className="w-24 shrink-0"
            />
            <span className="w-20 text-right font-mono text-xs tabular-nums whitespace-nowrap text-muted-foreground">
              {burn ? (
                <>
                  {ccFmtBurn(burn.rate)} / {ccFmtWindowLabel(burn.window)}
                </>
              ) : (
                "—"
              )}
            </span>
            {/* How long the budget lasts at that burn. The attention list this
                page used to carry was the only home for it; it lives here now,
                so the merge loses no fact. */}
            <span
              className={cn(
                "w-24 text-right text-xs whitespace-nowrap",
                exhaustion?.kind === "exhausted"
                  ? toneText({ tone: "danger" })
                  : toneText({ tone: "muted" }),
              )}
              title="Time to exhaustion"
            >
              {exhaustion?.label ?? "—"}
            </span>
          </>
        )}
      </span>
      {/* Always rendered, so a row with no firing tier still reserves the slot
          and every row's metrics land on the same column. Left-aligned, unlike
          the numeric columns beside it: these are categorical labels, and a
          shared left edge is what makes them scan as a column. */}
      <span className="flex w-40 shrink-0 flex-wrap gap-2">
        {firing.map((f) => (
          <CcSloTierBadge
            key={f.tier}
            tier={f.tier}
            severity={f.severity}
            tiers={tiers}
          />
        ))}
      </span>
    </Link>
  );
}

export function CcSloPostureCard({
  posture,
  pending,
}: {
  posture: CcSloPosture[];
  pending: boolean;
}) {
  return (
    <SectionCard title="Error budgets" linkLabel="All SLOs" to="/alerts/slos">
      {pending ? (
        <div className="space-y-2 px-3 py-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      ) : posture.length === 0 ? (
        <p className="px-3 pt-1 pb-3 text-xs text-muted-foreground">
          No SLOs yet. Define one as code — an SLI query, a target, a window —
          and apply it with{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]">
            everr apply
          </code>
          ; its error budget shows up here.
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {posture.map((p) => (
            <SloPostureRow key={p.slo.id} {...p} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
