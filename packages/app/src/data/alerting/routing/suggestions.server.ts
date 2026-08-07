import { resolveTimeRange } from "@everr/ui/lib/time-range";
import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  queryPostgresObservedLabelKeys,
  queryPostgresObservedLabelValues,
} from "../history/repository.server";
import { listAlerts } from "../instances/repository";
import { alertingRuleIdentity } from "../rules/identity";
import { listAllRules } from "../rules/repository";
import { alertingOrganizationId } from "../session";
import {
  ALERTING_CANONICAL_SLO_TIERS,
  alertingSloIdentity,
} from "../slos/model";
import { listSlos } from "../slos/repository";
import {
  ALERTING_SLO_RESERVED_LABEL_KEYS,
  ALERTING_SYNTHETIC_LABEL_KEYS,
  ALERTING_SYNTHETIC_LABEL_VALUES,
} from "./synthetic-labels";

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
      queryPostgresObservedLabelKeys(org, {
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
    const reserved = [
      ...ALERTING_SYNTHETIC_LABEL_KEYS,
      ...ALERTING_SLO_RESERVED_LABEL_KEYS,
    ];
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
        case "slo": {
          const slos = await listSlos(org).catch(() => []);
          return slos.map((slo) => ({
            value: slo.id,
            hint: alertingSloIdentity(slo).name,
          }));
        }
        case "slo_tier":
          return ALERTING_CANONICAL_SLO_TIERS.map((tier) => ({
            value: tier.name,
          }));
        default: {
          const { fromDate, toDate } = resolveTimeRange(SUGGESTION_WINDOW);
          const [alerts, observed] = await Promise.allSettled([
            listAlerts(org),
            queryPostgresObservedLabelValues(org, key, {
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
