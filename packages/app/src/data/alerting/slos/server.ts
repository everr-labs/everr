import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import {
  findByResourceName,
  formatResourceName,
} from "@/data/as-code/identity";
import { getPreviewScopes } from "@/data/previews/repoids";
import { type ClickhouseQuery, querySqlApi } from "@/lib/clickhouse";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { AlertingError } from "../errors";
import { alertingOrganizationId } from "../session";
import type { AlertingSloView } from "../types";
import { alertingSloWindowSecs } from "./model";
import * as slos from "./repository";
import { visibleSlosForPreview } from "./resource/preview-overlay";
import { querySloBudgetNow, querySloBudgetSeries } from "./series.server";

function createSloQuery(org: string): ClickhouseQuery {
  return <T>(sql: string, params?: Record<string, unknown>) =>
    querySqlApi<T>(sql, org, params);
}

export const listAlertingSlos = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ preview: z.string().optional() }).optional())
  .handler(async ({ data, context: { session } }) => {
    const org = alertingOrganizationId(session);
    const preview = data?.preview?.trim() || null;
    const [definitions, scopes] = await Promise.all([
      slos.listSlos(org),
      preview === null ? null : getPreviewScopes(org, preview),
    ]);
    return visibleSlosForPreview(definitions, scopes);
  });

export const getAlertingSlo = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(({ data: { sloId }, context: { session } }) =>
    slos.getSlo(alertingOrganizationId(session), sloId),
  );

export const getAlertingSloByName = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(
    z.object({
      project: z.string(),
      slug: z.string(),
      preview: z.string().optional(),
    }),
  )
  .handler(async ({ data, context: { session } }) => {
    const org = alertingOrganizationId(session);
    const preview = data.preview?.trim() || null;
    let candidates: AlertingSloView[];
    if (preview === null) {
      candidates = await slos.listSlos(org, { previewId: null });
    } else {
      const [definitions, scopes] = await Promise.all([
        slos.listSlos(org),
        getPreviewScopes(org, preview),
      ]);
      candidates = visibleSlosForPreview(definitions, scopes);
    }
    const slo = findByResourceName(candidates, data.project, data.slug);
    if (!slo) {
      throw new AlertingError(
        404,
        "not_found",
        `SLO not found: ${formatResourceName(data.project, data.slug)}`,
      );
    }
    return slo;
  });

export const getAlertingSloStatus = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(({ data: { sloId }, context: { session } }) =>
    slos.getSloStatus(alertingOrganizationId(session), sloId),
  );

export const getAlertingSloBudgetSeries = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(
    z.object({
      sloId: z.string().min(1),
      timeRange: TimeRangeSchema,
      points: z.number().int().min(2).max(200).default(60),
    }),
  )
  .handler(
    async ({ data: { sloId, timeRange, points }, context: { session } }) => {
      const org = alertingOrganizationId(session);
      const slo = await slos.getSlo(org, sloId);
      const windowSecs = alertingSloWindowSecs(slo.spec);
      if (windowSecs === null) return [];
      const { fromISO, toISO } = resolveTimeRange(timeRange);
      return querySloBudgetSeries(createSloQuery(org), {
        sliSql: slo.spec.sli.sql,
        targetPercent: slo.spec.targetPercent,
        windowSecs,
        fromISO,
        toISO,
        points,
      });
    },
  );

export const getAlertingSloBudgetNow = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ sloId: z.string().min(1) }))
  .handler(async ({ data: { sloId }, context: { session } }) => {
    const org = alertingOrganizationId(session);
    const slo = await slos.getSlo(org, sloId);
    const windowSecs = alertingSloWindowSecs(slo.spec);
    if (windowSecs === null) return null;
    return querySloBudgetNow(createSloQuery(org), {
      sliSql: slo.spec.sli.sql,
      targetPercent: slo.spec.targetPercent,
      windowSecs,
      nowMs: Date.now(),
    });
  });

export const pauseAlertingSlo = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(({ data: { sloId }, context: { session } }) =>
    slos.pauseSlo(alertingOrganizationId(session), sloId),
  );

export const resumeAlertingSlo = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(({ data: { sloId }, context: { session } }) =>
    slos.resumeSlo(alertingOrganizationId(session), sloId),
  );
