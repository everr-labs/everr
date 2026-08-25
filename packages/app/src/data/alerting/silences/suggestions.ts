import { resolveTimeRange } from "@everr/ui/lib/time-range";
import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  queryClickHouseObservedLabelKeys,
  queryClickHouseObservedLabelValues,
} from "../history/repository.server";
import { listAlerts } from "../instances/repository";
import { alertingRuleIdentity } from "../rules/identity";
import { listAllRules } from "../rules/repository";
import { AlertingSeveritySchema } from "../schema";
import { alertingOrganizationId } from "../session";

/**
 * The labels the dispatcher stamps on every event, which a matcher can
 * therefore always use. `alertingSyntheticLabels` is the writer; a key here
 * that it does not write would offer a matcher that can never match.
 */
const ALERTING_SYNTHETIC_LABEL_KEYS = ["severity", "status", "rule"] as const;

/** The values a synthetic key can hold. Rule ids are tenant-specific. */
const ALERTING_SYNTHETIC_LABEL_VALUES: Partial<
  Record<(typeof ALERTING_SYNTHETIC_LABEL_KEYS)[number], readonly string[]>
> = {
  severity: AlertingSeveritySchema.options,
  status: ["firing", "resolved"],
};

const SUGGESTION_WINDOW = { from: "now-7d", to: "now" } as const;
const SUGGESTION_LIMIT = 100;

export type AlertingLabelKeySuggestion = { key: string; synthetic: boolean };
export type AlertingLabelValueSuggestion = { value: string; hint?: string };

const settled = <T>(result: PromiseSettledResult<T>, fallback: T): T =>
  result.status === "fulfilled" ? result.value : fallback;

export const listAlertingLabelKeys = createAuthenticatedServerFn({
  method: "GET",
}).handler(
  async ({ context: { session } }): Promise<AlertingLabelKeySuggestion[]> => {
    const org = alertingOrganizationId(session);
    const { fromDate, toDate } = resolveTimeRange(SUGGESTION_WINDOW);
    const [observed, rules, alerts] = await Promise.allSettled([
      queryClickHouseObservedLabelKeys(org, {
        limit: SUGGESTION_LIMIT,
        from: fromDate,
        to: toDate,
      }),
      listAllRules(org),
      listAlerts(org),
    ]);
    const merged = new Set<string>(settled(observed, []));
    for (const rule of settled(rules, [])) {
      for (const key of rule.spec.label_columns) merged.add(key);
    }
    for (const alert of settled(alerts, [])) {
      for (const key of Object.keys(alert.labels)) merged.add(key);
    }
    const reserved = [...ALERTING_SYNTHETIC_LABEL_KEYS];
    for (const key of reserved) merged.delete(key);
    return [
      ...reserved.map((key) => ({ key, synthetic: true })),
      ...[...merged]
        .slice(0, SUGGESTION_LIMIT)
        .map((key) => ({ key, synthetic: false })),
    ];
  },
);

export const listAlertingLabelValues = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ key: z.string().min(1) }))
  .handler(
    async ({
      data: { key },
      context: { session },
    }): Promise<AlertingLabelValueSuggestion[]> => {
      const org = alertingOrganizationId(session);
      const staticValues =
        ALERTING_SYNTHETIC_LABEL_VALUES[
          key as keyof typeof ALERTING_SYNTHETIC_LABEL_VALUES
        ];
      if (staticValues) return staticValues.map((value) => ({ value }));
      switch (key) {
        case "rule": {
          const rules = await listAllRules(org).catch(() => []);
          return rules.map((rule) => ({
            value: rule.id,
            hint: alertingRuleIdentity(rule).name,
          }));
        }
        default: {
          const { fromDate, toDate } = resolveTimeRange(SUGGESTION_WINDOW);
          const [alerts, observed] = await Promise.allSettled([
            listAlerts(org),
            queryClickHouseObservedLabelValues(org, key, {
              limit: SUGGESTION_LIMIT,
              from: fromDate,
              to: toDate,
            }),
          ]);
          const merged = new Set<string>();
          for (const alert of settled(alerts, [])) {
            const value = alert.labels[key];
            if (value) merged.add(value);
          }
          for (const value of settled(observed, [])) merged.add(value);
          return [...merged]
            .slice(0, SUGGESTION_LIMIT)
            .map((value) => ({ value }));
        }
      }
    },
  );
