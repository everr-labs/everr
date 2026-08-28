/**
 * Alert rules as the triage screen reads them: the PostgreSQL rows, the
 * identity a reader recognizes a rule by, and the state a row can answer for
 * on its own.
 */
import { notFound } from "@tanstack/react-router";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ANN_DISPLAY_NAME } from "@/data/alerting/resource-annotations";
import { alertingConditionOperatorLabel } from "@/data/alerting/rules/condition";
import type {
  AlertingEvaluationSample,
  AlertingRuleSpec,
} from "@/data/alerting/types";
import { formatResourceName, parseResourceName } from "@/data/as-code/identity";
import { db } from "@/db/client";
import { alertDefinitions, alertInstances } from "@/db/schema";
import { compareRuleLabels } from "./format";
import type { AlertRuleOption, RuleInventoryState, TriageStatus } from "./view";

export type DefinitionRow = typeof alertDefinitions.$inferSelect;
export type InstanceRow = typeof alertInstances.$inferSelect;

/** `link.runbook` is a full URL. The last two path segments are the runbook's
 *  own `project/slug`, and the slug alone is what a reader recognizes. */
export function runbookLabel(href: string): string {
  const segments = href.split("?")[0].split("#")[0].split("/").filter(Boolean);
  return segments[segments.length - 1] || href;
}

export function rulePath(row: Pick<DefinitionRow, "project" | "slug">): string {
  return formatResourceName(row.project, row.slug);
}

/**
 * The rule's display name. Not `summary`: that annotation is the notification
 * title template, so it is full of `${placeholder}` that only means anything
 * once an instance has filled it in. `everr.display.name` is the name a person
 * wrote for the rule itself.
 */
export function ruleTitle(
  row: Pick<DefinitionRow, "slug"> & {
    spec: { annotations?: Record<string, string> | null };
  },
): string {
  return row.spec.annotations?.[ANN_DISPLAY_NAME]?.trim() || row.slug;
}

export function conditionText(spec: AlertingRuleSpec): string {
  return `value ${alertingConditionOperatorLabel(spec.condition.operator)} ${spec.condition.threshold}`;
}

/**
 * Live rules only. Preview copies never evaluate and never notify, so they
 * have no runtime state to triage; the preview frame is suppressed on this
 * page for the same reason.
 */
function liveRulesFilter(organizationId: string) {
  return and(
    eq(alertDefinitions.organizationId, organizationId),
    isNull(alertDefinitions.previewId),
  );
}

/**
 * Every live rule, in the order the inventory prints them.
 *
 * Sorted here rather than in the SELECT because the label is `ruleTitle`: an
 * annotation with a trim and a fallback to the slug, and a second copy of that
 * rule written as an ORDER BY expression is one that can drift from the one
 * the list renders. Sorting is not cosmetic. An unordered SELECT hands back
 * heap order, and every evaluation rewrites the row it just read, so the list
 * reshuffled underneath whoever was reading it. It also settles the ties in
 * the triage list above, which sorts by band and severity and otherwise keeps
 * the order it was given.
 */
export async function loadRules(
  organizationId: string,
): Promise<DefinitionRow[]> {
  const rows = await db
    .select()
    .from(alertDefinitions)
    .where(liveRulesFilter(organizationId));
  return rows
    .map((row) => ({ row, label: ruleTitle(row), path: rulePath(row) }))
    .sort(compareRuleLabels)
    .map((entry) => entry.row);
}

/**
 * Path, project and display name for every live rule: what the silence picker
 * offers, and what lets a screen that stores only a path print the name a
 * person would recognize.
 *
 * `loadRules` selects every column, `spec` included, and the SQL of every rule
 * in the org is a large thing to read to write a list of names. Only the
 * annotations object is pulled out, so a rule costs a handful of short strings
 * rather than its whole definition, and `ruleTitle` still resolves the name:
 * one implementation, so the picker and the Silences list cannot print two
 * different names for one rule.
 *
 * Ordered by the two columns that compose the path, which is an order the
 * database can produce without seeing the annotation. Callers that print names
 * sort on the name.
 */
export async function loadRuleOptions(
  organizationId: string,
): Promise<AlertRuleOption[]> {
  const rows = await db
    .select({
      project: alertDefinitions.project,
      slug: alertDefinitions.slug,
      // The annotations object, not the one name inside it: the name is
      // `ruleTitle`'s to resolve, and a second copy of its trim-and-fallback
      // written as SQL is one that can drift from the one every other screen
      // prints. This keeps the point of the read, which is not fetching the
      // whole spec.
      annotations: sql<Record<
        string,
        string
      > | null>`${alertDefinitions.spec}->'annotations'`,
    })
    .from(alertDefinitions)
    .where(liveRulesFilter(organizationId))
    .orderBy(alertDefinitions.project, alertDefinitions.slug);
  return rows.map((row) => ({
    path: rulePath(row),
    project: row.project,
    name: ruleTitle({
      slug: row.slug,
      spec: { annotations: row.annotations },
    }),
  }));
}

/**
 * One live rule by its `project/slug` path, the only identity the screen
 * knows a rule by. The shape is checked before it reaches the database, and
 * not found is the caller's 404: the name came from the URL or from a row on
 * the screen, and either way the rule it named is gone.
 */
export async function loadRule(
  organizationId: string,
  path: string,
): Promise<DefinitionRow> {
  const { project, slug } = parseResourceName(path);
  const [row] = await db
    .select()
    .from(alertDefinitions)
    .where(
      and(
        liveRulesFilter(organizationId),
        eq(alertDefinitions.project, project),
        eq(alertDefinitions.slug, slug),
      ),
    )
    .limit(1);
  if (!row) throw notFound();
  return row;
}

export async function loadInstances(
  organizationId: string,
  definitionIds: string[],
): Promise<InstanceRow[]> {
  if (definitionIds.length === 0) return [];
  return db
    .select()
    .from(alertInstances)
    .where(
      and(
        eq(alertInstances.organizationId, organizationId),
        inArray(alertInstances.alertDefinitionId, definitionIds),
      ),
    );
}

/** One rule's instances, highest value first. */
export async function loadRuleInstances(
  organizationId: string,
  definitionId: string,
): Promise<InstanceRow[]> {
  return db
    .select()
    .from(alertInstances)
    .where(
      and(
        eq(alertInstances.organizationId, organizationId),
        eq(alertInstances.alertDefinitionId, definitionId),
      ),
    )
    .orderBy(desc(alertInstances.value));
}

/**
 * The rule's own state, before anyone asks whether it is silenced.
 *
 * `firing` and `pending` are instance rollups; `degraded` is health, and it
 * wins, because a rule that cannot evaluate has no trustworthy rollup.
 */
function ruleState(row: DefinitionRow): TriageStatus | "paused" | "inactive" {
  // Paused wins over everything: a rule that is not being evaluated has no
  // current state, only the one it had when it stopped.
  if (!row.active) return "paused";
  if (row.degradedSince !== null) return "degraded";
  if (row.currentState === "firing") return "firing";
  if (row.currentState === "pending") return "pending";
  return "inactive";
}

/** Silenced is a label on firing, not a state of its own: the rule is still
 *  firing, nobody is being told about it. */
export function inventoryState(
  row: DefinitionRow,
  silenced: boolean,
): RuleInventoryState {
  const state = ruleState(row);
  return silenced && state === "firing" ? "silenced" : state;
}

/** The states that want attention: a paused rule is not being evaluated, and
 *  an inactive one has nothing to answer for. Silencing is not asked about
 *  here, because a silenced rule keeps the band its state earns and is dimmed
 *  in place rather than moved. */
export function triageStatus(row: DefinitionRow): TriageStatus | null {
  const state = ruleState(row);
  return state === "paused" || state === "inactive" ? null : state;
}

/** Worst first: state, then the number behind it. One order, so the headline
 *  instance on a row and the top of the detail list are never a different
 *  instance. */
const INSTANCE_RANK = { firing: 2, pending: 1, inactive: 0 } as const;

function byWorstInstance(
  a: { status: keyof typeof INSTANCE_RANK; value: number | null },
  b: typeof a,
): number {
  return (
    INSTANCE_RANK[b.status] - INSTANCE_RANK[a.status] ||
    (b.value ?? -Infinity) - (a.value ?? -Infinity)
  );
}

/** The instance a responder should look at: the worst breaching one, or the
 *  highest value seen when nothing breaches. */
export function worstInstance(instances: InstanceRow[]): InstanceRow | null {
  return instances.reduce<InstanceRow | null>(
    (worst, row) => (worst && byWorstInstance(worst, row) <= 0 ? worst : row),
    null,
  );
}

export function measuredText(
  row: DefinitionRow,
  instances: InstanceRow[],
): string {
  if (row.degradedSince !== null) {
    return `no rows · ${row.consecutiveFailures} consecutive ${row.consecutiveFailures === 1 ? "failure" : "failures"}`;
  }
  const rows = row.lastRowCount;
  const rowsText = `${rows} ${rows === 1 ? "row" : "rows"}`;
  // Breaching is the same count `instanceSummary` reports: an instance whose
  // condition is true, pending ones included. Pending has crossed the
  // threshold and is only waiting out the `for` clause, and a row that called
  // it healthy here while the detail panel counted it would put two numbers
  // for one rule on the screen at once.
  const breaching = instances.filter((i) => i.status !== "inactive").length;
  if (breaching === 0) return rowsText;
  return `worst of ${breaching} breaching · ${rowsText}`;
}

/**
 * "2 of 3 breaching". The fraction is what the reader is after, and the
 * firing/pending split is already in the row's own tone and tooltip.
 *
 * The total counts every series the last evaluation looked at, not only the
 * ones the engine is tracking. A rule tracks a series once it breaches, so a
 * total built from the tracked rows alone answers "which are firing" and
 * hides "out of how many": the healthy series is what says the query still
 * returns the other rows. A tracked instance the last evaluation did not
 * return still counts: it is open, and dropping it would retire it in the UI
 * before the engine retires it.
 */
export function instanceSummary(
  rows: InstanceRow[],
  samples: AlertingEvaluationSample[],
): string {
  const fingerprints = new Set(samples.map((sample) => sample.fingerprint));
  let breaching = 0;
  for (const row of rows) {
    fingerprints.add(row.fingerprint);
    if (row.status !== "inactive") breaching += 1;
  }
  if (fingerprints.size === 0) return "no instances";
  return `${breaching} of ${fingerprints.size} breaching`;
}
