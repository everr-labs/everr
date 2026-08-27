import * as z from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { isUsageMeter, type UsageMeter } from "@/lib/usage-limits";

const UsageRangeInputSchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .refine(({ from, to }) => Date.parse(from) < Date.parse(to), {
    message: "Usage range must end after it starts",
    path: ["to"],
  });

const USAGE_AGGREGATES_SQL = `meter,
  sum(bytes) AS bytes,
  sum(items) AS items`;
const USAGE_RANGE_SQL = `bucket >= toStartOfHour(
  parseDateTimeBestEffort({from:String}),
  'UTC'
)
  AND bucket < toStartOfHour(
    parseDateTimeBestEffort({to:String}),
    'UTC'
  )`;

export type OrgUsage = {
  meter: UsageMeter;
  bytes: number;
  items: number;
};

export type OrgUsageSeriesPoint = OrgUsage & {
  date: string;
};

type RawUsage = {
  meter: string;
  bytes: string | number;
  items: string | number;
};

type RawUsageSeriesPoint = RawUsage & {
  date: string;
};

function normalizeUInt64(value: string | number, column: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`Invalid ClickHouse UInt64 value for ${column}`);
  }
  return normalized;
}

function normalizeUsage(row: RawUsage): OrgUsage | null {
  if (!isUsageMeter(row.meter)) return null;
  return {
    meter: row.meter,
    bytes: normalizeUInt64(row.bytes, "bytes"),
    items: normalizeUInt64(row.items, "items"),
  };
}

export const getOrgUsage = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(UsageRangeInputSchema)
  .handler(async ({ data: { from, to }, context: { clickhouse } }) => {
    const rows = await clickhouse.query<RawUsage>(
      `
        SELECT
          ${USAGE_AGGREGATES_SQL}
        FROM app.tenant_usage
        WHERE ${USAGE_RANGE_SQL}
        GROUP BY meter
        ORDER BY meter ASC
      `,
      { from, to },
    );

    return rows.flatMap((row) => {
      const usage = normalizeUsage(row);
      return usage === null ? [] : [usage];
    });
  });

export const getOrgUsageSeries = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(UsageRangeInputSchema)
  .handler(async ({ data: { from, to }, context: { clickhouse } }) => {
    const rows = await clickhouse.query<RawUsageSeriesPoint>(
      `
        SELECT
          toString(toDate(bucket, 'UTC')) AS date,
          ${USAGE_AGGREGATES_SQL}
        FROM app.tenant_usage
        WHERE ${USAGE_RANGE_SQL}
        GROUP BY date, meter
        ORDER BY date ASC, meter ASC
      `,
      { from, to },
    );

    return rows.flatMap((row) => {
      const usage = normalizeUsage(row);
      return usage === null ? [] : [{ date: row.date, ...usage }];
    });
  });
