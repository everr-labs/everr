import { and, eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { encryptChannelConfig } from "@/data/alerting/delivery/channel-secrets.server";
import { enqueueAlertEvaluation } from "@/data/alerting/scheduling/evaluation-jobs.server";
import type { AlertingMatcher, AlertingRuleSpec } from "@/data/alerting/types";
import type * as schema from "@/db/schema";
import {
  alertChannels,
  alertDefinitionChannels,
  alertDefinitions,
  alertInhibitions,
  alertReceiverChannels,
  alertReceivers,
  alertRoutes,
  alertSilences,
  previews,
} from "@/db/schema";

type Db = PgliteDatabase<typeof schema>;

// Tasks 6-12 build the test files that import this alongside insertDirectRule;
// only the smoke test consumes this module so far.
// fallow-ignore-next-line unused-export
export const TEST_ORG = "org_test";

export interface RuleFixture {
  id: string;
  organizationId: string;
  project: string;
  slug: string;
}

interface RuleOverrides {
  organizationId?: string;
  slug?: string;
  project?: string;
  sql?: string;
  forSecs?: number;
  intervalSecs?: number;
  labelColumns?: string[];
  severity?: AlertingRuleSpec["severity"];
  resolveAfter?: number;
  nextEvaluationAt?: Date;
  previewId?: string | null;
  active?: boolean;
}

function ruleSpec(overrides: RuleOverrides): AlertingRuleSpec {
  return {
    sql: overrides.sql ?? "select 'checkout' as service, 42 as value",
    interval_secs: overrides.intervalSecs ?? 60,
    for_secs: overrides.forSecs ?? 0,
    label_columns: overrides.labelColumns ?? ["service"],
    // {operator, threshold} is the real AlertingRuleCondition shape (see
    // AlertingRuleConditionSchema); default breaches against the default
    // sample row's value of 42.
    condition: { operator: "gt", threshold: 0 },
    severity: overrides.severity ?? "warning",
    annotations: { summary: "{{ labels.service }} is breaching" },
    resolve_after: overrides.resolveAfter ?? 1,
  };
}

// fallow-ignore-next-line unused-export
export async function insertRule(
  db: Db,
  overrides: RuleOverrides = {},
): Promise<RuleFixture> {
  const [row] = await db
    .insert(alertDefinitions)
    .values({
      organizationId: overrides.organizationId ?? TEST_ORG,
      repoid: "repo_test",
      project: overrides.project ?? "default",
      slug: overrides.slug ?? "checkout-latency",
      spec: ruleSpec(overrides),
      previewId: overrides.previewId ?? null,
      active: overrides.active ?? true,
      // Due now, so the scanner picks it up on the first drain.
      nextEvaluationAt: overrides.nextEvaluationAt ?? new Date(),
    })
    .returning({
      id: alertDefinitions.id,
      organizationId: alertDefinitions.organizationId,
      project: alertDefinitions.project,
      slug: alertDefinitions.slug,
      version: alertDefinitions.version,
      nextEvaluationAt: alertDefinitions.nextEvaluationAt,
    });
  // Mirrors createRule's own scheduleEvaluation (repository.ts): the API
  // enqueues the first evaluation in the same transaction as the insert.
  // The scanner cron is only a backstop for a job that went missing after
  // that, not what starts a rule off, so a bare row insert here would sit
  // in the table forever with nothing to evaluate it.
  await enqueueAlertEvaluation({
    alertDefinitionId: row.id,
    scheduledFor: (row.nextEvaluationAt ?? new Date()).toISOString(),
    ruleVersion: row.version,
  });
  return {
    id: row.id,
    organizationId: row.organizationId,
    project: row.project,
    slug: row.slug,
  };
}

// fallow-ignore-next-line unused-export
export async function insertChannel(
  db: Db,
  overrides: {
    organizationId?: string;
    name?: string;
    type?: "slack" | "discord" | "webhook" | "telegram";
  } = {},
) {
  const organizationId = overrides.organizationId ?? TEST_ORG;
  const name = overrides.name ?? "oncall";
  const type = overrides.type ?? "slack";
  const config =
    type === "telegram"
      ? { type, bot_token: "bot-token", chat_ids: ["1"] }
      : // An IP literal, not a hostname: the real sender validates the
        // outbound URL with a live DNS lookup before it ever reaches the
        // stubbed `fetch` (SSRF guard), and "example.test" does not resolve.
        // 203.0.113.0/24 (RFC 5737 TEST-NET-3) is reserved for documentation,
        // never routed, and not on the guard's blocked-range list, so the
        // lookup is skipped and the send reaches the stub.
        { type, url: `https://203.0.113.10/${type}` };
  const [created] = await db
    .insert(alertChannels)
    .values({ organizationId, name, encryptedConfig: "" })
    .returning({ id: alertChannels.id });
  // The config is sealed against the channel id, so it can only be written
  // once the row exists.
  await db
    .update(alertChannels)
    .set({
      encryptedConfig: encryptChannelConfig(
        organizationId,
        created.id,
        config as never,
      ),
    })
    .where(eq(alertChannels.id, created.id));
  return { id: created.id, name };
}

/**
 * A preview row, needed before any rule may carry a `previewId`: the rule's
 * foreign key is composite over (preview_id, organization_id, repoid).
 */
// fallow-ignore-next-line unused-export
export async function insertPreview(
  db: Db,
  overrides: { organizationId?: string; name?: string } = {},
) {
  const [preview] = await db
    .insert(previews)
    .values({
      organizationId: overrides.organizationId ?? TEST_ORG,
      repoid: "repo_test",
      name: overrides.name ?? "gio/branch",
    })
    .returning({ id: previews.id });
  return preview;
}

// fallow-ignore-next-line unused-export
export async function insertReceiver(
  db: Db,
  overrides: {
    organizationId?: string;
    name?: string;
    channelIds?: string[];
  } = {},
) {
  const organizationId = overrides.organizationId ?? TEST_ORG;
  const name = overrides.name ?? "team-payments";
  const [receiver] = await db
    .insert(alertReceivers)
    .values({ organizationId, name })
    .returning({ id: alertReceivers.id });
  const channelIds = overrides.channelIds ?? [];
  if (channelIds.length > 0) {
    await db.insert(alertReceiverChannels).values(
      channelIds.map((channelId, position) => ({
        organizationId,
        receiverId: receiver.id,
        channelId,
        position,
      })),
    );
  }
  return { id: receiver.id, name };
}

// fallow-ignore-next-line unused-export
export async function insertRoute(
  db: Db,
  overrides: {
    organizationId?: string;
    receiver?: string;
    priority?: number;
    matchers?: AlertingMatcher[];
    continue?: boolean;
    groupBy?: string[] | null;
    groupWaitSecs?: number | null;
    groupIntervalSecs?: number | null;
    repeatIntervalSecs?: number | null;
  } = {},
) {
  const organizationId = overrides.organizationId ?? TEST_ORG;
  const receiverName = overrides.receiver ?? "team-payments";
  // alert_routes.receiver_id is a foreign key, not a name column, so the
  // receiver must already exist. insertReceiver's own default name matches
  // this builder's default, so the common pairing needs no override.
  const [receiver] = await db
    .select({ id: alertReceivers.id })
    .from(alertReceivers)
    .where(
      and(
        eq(alertReceivers.organizationId, organizationId),
        eq(alertReceivers.name, receiverName),
      ),
    )
    .limit(1);
  if (!receiver) {
    throw new Error(
      `insertRoute: no receiver named "${receiverName}" in ${organizationId}; call insertReceiver first`,
    );
  }
  const [route] = await db
    .insert(alertRoutes)
    .values({
      organizationId,
      receiverId: receiver.id,
      priority: overrides.priority ?? 0,
      // The route's non-identity fields live in one jsonb column, in the
      // same snake_case shape AlertingRouteInputSchema defines.
      config: {
        matchers: overrides.matchers ?? [],
        continue: overrides.continue ?? false,
        group_by: overrides.groupBy ?? null,
        group_wait_secs: overrides.groupWaitSecs ?? null,
        group_interval_secs: overrides.groupIntervalSecs ?? null,
        repeat_interval_secs: overrides.repeatIntervalSecs ?? null,
      },
    })
    .returning({ id: alertRoutes.id });
  return route;
}

/** A rule wired straight to one channel: the shortest path to a delivery. */
export async function insertDirectRule(
  db: Db,
  overrides: RuleOverrides & {
    channelType?: "slack" | "discord" | "webhook" | "telegram";
  } = {},
): Promise<RuleFixture> {
  const rule = await insertRule(db, overrides);
  const channel = await insertChannel(db, {
    organizationId: rule.organizationId,
    type: overrides.channelType ?? "slack",
  });
  await db.insert(alertDefinitionChannels).values({
    organizationId: rule.organizationId,
    alertDefinitionId: rule.id,
    channelId: channel.id,
    position: 0,
  });
  return rule;
}

// fallow-ignore-next-line unused-export
export async function insertSilence(
  db: Db,
  overrides: {
    organizationId?: string;
    matchers?: AlertingMatcher[];
    startsAt?: Date;
    endsAt?: Date;
  } = {},
) {
  const now = new Date();
  const [silence] = await db
    .insert(alertSilences)
    .values({
      organizationId: overrides.organizationId ?? TEST_ORG,
      matchers: overrides.matchers ?? [
        { label: "service", op: "eq", value: "checkout" },
      ],
      startsAt: overrides.startsAt ?? now,
      endsAt: overrides.endsAt ?? new Date(now.getTime() + 3_600_000),
    })
    .returning({ id: alertSilences.id });
  return silence;
}

// fallow-ignore-next-line unused-export
export async function insertInhibition(
  db: Db,
  overrides: {
    organizationId?: string;
    sourceMatchers?: AlertingMatcher[];
    targetMatchers?: AlertingMatcher[];
    equalLabels?: string[];
  } = {},
) {
  const [inhibition] = await db
    .insert(alertInhibitions)
    .values({
      organizationId: overrides.organizationId ?? TEST_ORG,
      // source_matchers/target_matchers/equal live in one jsonb column, in
      // the same snake_case shape AlertingInhibitionInputSchema defines.
      config: {
        source_matchers: overrides.sourceMatchers ?? [
          { label: "rule", op: "eq", value: "default/cluster-down" },
        ],
        target_matchers: overrides.targetMatchers ?? [
          { label: "rule", op: "eq", value: "default/checkout-latency" },
        ],
        equal: overrides.equalLabels ?? [],
      },
    })
    .returning({ id: alertInhibitions.id });
  return inhibition;
}
