import { bucketSeconds } from "@everr/ui/lib/bucket";
import { resolveTimeRange } from "@everr/ui/lib/time-range";
import type {
  AttributeKey,
  AttributeKeysInput,
  AttributeValuesInput,
} from "../../attribute-filter/schemas";
import { normalizeTimestampToUtc } from "../../logs/util/timestamp";
import { validateTableName } from "../../sql/table";
import { bucketMs, bucketStarts } from "./buckets";
import { type ProfileStackRow, rowToStack } from "../model/flame-tree";
import type { ProfileSource } from "../model/source-link";
import type { ProfileVersion } from "../model/versions";
import type { SqlClient } from "./client";
import {
  PROFILE_EXAMPLE_TRACE_LIMIT,
  PROFILE_HISTOGRAM_BUCKETS,
  PROFILE_STACK_LIMIT,
  PROFILES_ATTRIBUTE_SOURCES,
  type ProfileExampleTracesInput,
  type ProfiledSpansInput,
  type ProfileFilterInput,
  PROFILE_TIMELINE_SAMPLE_LIMIT,
  type ProfileHistogramInput,
  type ProfileServicesInput,
  type ProfileSpanTimelineInput,
  type ProfileStacksInput,
} from "./schemas";
import type {
  ProfileExampleTrace,
  ProfileHistogramBucket,
  ProfileSpanTimeline,
  ProfileStacks,
  SampleTypeOption,
} from "./types";
import { buildProfileWhere, profileAttributeColumn } from "./where";

// A sample without values is weighted by its timestamps: each one is an
// observation. `length` is unsigned, so cast it to match arraySum(Int64).
const SAMPLE_WEIGHT_SQL =
  "if(empty(Values), toInt64(length(TimestampsUnixNano)), arraySum(Values))";

/**
 * Snapshot types describe what is live at one instant, not what happened over
 * the profile's window, so their weights average across profiles instead of
 * adding up. pprof names them `inuse_*`.
 */
function isSnapshotSampleType(sampleType: string): boolean {
  return sampleType.startsWith("inuse_");
}

const ATTRIBUTE_KEY_LIMIT = 200;
const ATTRIBUTE_VALUE_LIMIT = 100;
const VERSION_LIMIT = 100;

type StackRowRaw = ProfileStackRow & {
  repository: string;
  revision: string;
  totalValue: string | number;
  stackCount: string | number;
  snapshots: string | number;
};

export class ProfilesRepository {
  private readonly tableName: string;

  constructor(
    private readonly client: SqlClient,
    options: ProfilesRepositoryOptions = {},
  ) {
    this.tableName = options.tableName ?? "profiles";
    validateTableName(this.tableName);
  }

  /** Services with profiles in the range, for the shared Service filter. */
  async listServices(input: ProfileServicesInput): Promise<string[]> {
    const where = buildProfileWhere({ timeRange: input.timeRange, attributes: [] });
    const rows = await this.client.execute<{ serviceName: string }>(
      /* sql */ `
      SELECT DISTINCT ServiceName AS serviceName
      FROM ${this.tableName}
      WHERE ${where.clause}
      ORDER BY serviceName
    `,
      where.params,
    );
    return rows.map((row) => row.serviceName);
  }

  async listSampleTypes(input: ProfileFilterInput): Promise<SampleTypeOption[]> {
    const where = buildProfileWhere(input);
    return this.client.execute<SampleTypeOption>(
      /* sql */ `
      SELECT SampleType AS sampleType, SampleUnit AS sampleUnit
      FROM ${this.tableName}
      WHERE ${where.clause}
      GROUP BY sampleType, sampleUnit
      ORDER BY sampleType, sampleUnit
    `,
      where.params,
    );
  }

  async stacks(input: ProfileStacksInput): Promise<ProfileStacks> {
    const where = buildProfileWhere(input);
    const snapshot = isSnapshotSampleType(input.sampleType);
    // Aggregating per StackHash before the limit keeps the response bounded no
    // matter how many samples fall in the window; the window functions report
    // what the limit cut off.
    const rows = await this.client.execute<StackRowRaw>(
      /* sql */ `
      WITH
      ${
        snapshot
          ? `(
        SELECT greatest(uniqExact(ProfileId), 1)
        FROM ${this.tableName}
        WHERE ${where.clause}
      )`
          : "1"
      } AS snapshots,
      stacks AS (
        SELECT
          StackHash                        AS stackHash,
          any(FunctionNames)               AS functionNames,
          any(FileNames)                   AS fileNames,
          any(LineNumbers)                 AS lineNumbers,
          any(MappingFileNames)            AS mappingFileNames,
          any(Addresses)                   AS addressValues,
          any(ResourceAttributes['vcs.repository.url.full']) AS repository,
          any(ResourceAttributes['vcs.ref.head.revision'])   AS revision,
          sum(${SAMPLE_WEIGHT_SQL})        AS weight
        FROM ${this.tableName}
        WHERE ${where.clause}
        GROUP BY StackHash
        HAVING weight > 0
      )
      SELECT
        functionNames,
        fileNames,
        lineNumbers,
        mappingFileNames,
        arrayMap(a -> hex(a), addressValues) AS addresses,
        repository,
        revision,
        toString(round(weight / snapshots))  AS value,
        toString(round(sum(weight) OVER () / snapshots)) AS totalValue,
        count() OVER ()                      AS stackCount,
        snapshots
      FROM stacks
      ORDER BY weight DESC, stackHash
      LIMIT {limit:UInt32}
    `,
      {
        ...where.params,
        limit: input.limit ?? PROFILE_STACK_LIMIT,
      },
    );
    const first = rows[0];
    // Every stack of a deploy shares one revision, so the response carries
    // each distinct one once and the stacks point at it.
    const sources: ProfileSource[] = [];
    const sourceIndex = new Map<string, number>();
    const stacks = rows.map((row) => {
      const stack = rowToStack(row);
      if (!row.repository || !row.revision) return stack;
      const key = `${row.repository}\u0000${row.revision}`;
      let index = sourceIndex.get(key);
      if (index === undefined) {
        index = sources.length;
        sources.push({ repository: row.repository, revision: row.revision });
        sourceIndex.set(key, index);
      }
      return { ...stack, source: index };
    });
    return {
      stacks,
      totalValue: first ? Number(first.totalValue) : 0,
      stackCount: first ? Number(first.stackCount) : 0,
      ...(snapshot ? { snapshots: first ? Number(first.snapshots) : 0 } : {}),
      ...(sources.length > 0 ? { sources } : {}),
    };
  }

  /** `service.version` values, the most recently seen first. */
  async listVersions(input: ProfileFilterInput): Promise<ProfileVersion[]> {
    const where = buildProfileWhere({ ...input, versions: [] });
    const rows = await this.client.execute<{
      version: string;
      firstSeen: string;
      lastSeen: string;
    }>(
      /* sql */ `
      SELECT
        ResourceAttributes['service.version'] AS version,
        toString(min(Timestamp)) AS firstSeen,
        toString(max(Timestamp)) AS lastSeen
      FROM ${this.tableName}
      WHERE mapContains(ResourceAttributes, 'service.version')
        AND ${where.clause}
      GROUP BY version
      HAVING version != ''
      ORDER BY max(Timestamp) DESC
      LIMIT ${VERSION_LIMIT}
    `,
      where.params,
    );
    return rows.map((row) => ({
      version: row.version,
      firstSeen: normalizeTimestampToUtc(row.firstSeen),
      lastSeen: normalizeTimestampToUtc(row.lastSeen),
    }));
  }

  /** The spans whose samples ran a function, heaviest first. */
  async exampleTraces(input: ProfileExampleTracesInput): Promise<ProfileExampleTrace[]> {
    const where = buildProfileWhere(input);
    const rows = await this.client.execute<{
      traceId: string;
      spanId: string;
      serviceName: string;
      rootSpanName: string;
      value: string | number;
    }>(
      /* sql */ `
      SELECT
        TraceId AS traceId,
        SpanId AS spanId,
        any(ServiceName) AS serviceName,
        any(SampleAttributes['everr.root_span.name']) AS rootSpanName,
        toString(sum(${SAMPLE_WEIGHT_SQL})) AS value
      FROM ${this.tableName}
      WHERE TraceId != ''
        AND has(FunctionNames, {functionName:String})
        AND ${where.clause}
      GROUP BY traceId, spanId
      ORDER BY sum(${SAMPLE_WEIGHT_SQL}) DESC, traceId, spanId
      LIMIT {limit:UInt32}
    `,
      {
        ...where.params,
        functionName: input.functionName,
        limit: input.limit ?? PROFILE_EXAMPLE_TRACE_LIMIT,
      },
    );
    return rows.map((row) => ({ ...row, value: Number(row.value) }));
  }

  /** Sample weight over time, every bucket of the range present so gaps show. */
  async histogram(input: ProfileHistogramInput): Promise<ProfileHistogramBucket[]> {
    const where = buildProfileWhere(input);
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const intervalSeconds = bucketSeconds(
      fromDate,
      toDate,
      input.buckets ?? PROFILE_HISTOGRAM_BUCKETS,
    );
    const rows = await this.client.execute<{ bucket: string; value: string | number }>(
      /* sql */ `
      SELECT
        toStartOfInterval(toDateTime(Timestamp), INTERVAL ${intervalSeconds} SECOND) AS bucket,
        toString(${
          isSnapshotSampleType(input.sampleType)
            ? `round(sum(${SAMPLE_WEIGHT_SQL}) / uniqExact(ProfileId))`
            : `sum(${SAMPLE_WEIGHT_SQL})`
        }) AS value
      FROM ${this.tableName}
      WHERE ${where.clause}
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
      where.params,
    );
    return fillBuckets(rows, fromDate, toDate, intervalSeconds);
  }

  /** The ids of a trace's spans that have samples linked to them. */
  async profiledSpans(input: ProfiledSpansInput): Promise<string[]> {
    const where = buildProfileWhere({
      timeRange: input.timeRange,
      traceId: input.traceId,
      attributes: [],
    });
    const rows = await this.client.execute<{ spanId: string }>(
      /* sql */ `
      SELECT DISTINCT SpanId AS spanId
      FROM ${this.tableName}
      WHERE ${where.clause}
        AND SpanId != ''
    `,
      where.params,
    );
    return rows.map((row) => row.spanId);
  }

  /**
   * The span's samples one timestamp at a time, grouped by stack, so the
   * timeline can show what ran when. Rows without timestamps, from profilers
   * that only aggregate, are left out.
   */
  async spanTimeline(input: ProfileSpanTimelineInput): Promise<ProfileSpanTimeline> {
    const where = buildProfileWhere({
      timeRange: input.timeRange,
      traceId: input.traceId,
      spanId: input.spanId,
      sampleType: input.sampleType,
      sampleUnit: input.sampleUnit,
      attributes: [],
    });
    const limit = input.limit ?? PROFILE_TIMELINE_SAMPLE_LIMIT;
    const rows = await this.client.execute<
      ProfileStackRow & { timestampsNs: string[]; periodNs: string | number }
    >(
      /* sql */ `
      WITH samples AS (
        SELECT
          StackHash AS stackHash,
          FunctionNames,
          FileNames,
          LineNumbers,
          MappingFileNames,
          Addresses,
          if(PeriodUnit = 'nanoseconds', Period, 0) AS period,
          arrayJoin(TimestampsUnixNano) AS ts
        FROM ${this.tableName}
        WHERE ${where.clause}
          AND notEmpty(TimestampsUnixNano)
        ORDER BY ts
        LIMIT {limit:UInt32}
      )
      SELECT
        any(FunctionNames)                       AS functionNames,
        any(FileNames)                           AS fileNames,
        any(LineNumbers)                         AS lineNumbers,
        any(MappingFileNames)                    AS mappingFileNames,
        arrayMap(a -> hex(a), any(Addresses))    AS addresses,
        toString(count())                        AS value,
        arrayMap(t -> toString(t), arraySort(groupArray(ts))) AS timestampsNs,
        max(period)                              AS periodNs
      FROM samples
      GROUP BY stackHash
      ORDER BY count() DESC, stackHash
    `,
      {
        ...where.params,
        limit,
      },
    );
    const stacks = rows.map((row) => ({ ...rowToStack(row), timestampsNs: row.timestampsNs }));
    const sampleCount = stacks.reduce((sum, stack) => sum + stack.value, 0);
    return {
      stacks,
      periodNs: rows.reduce((max, row) => Math.max(max, Number(row.periodNs)), 0),
      truncated: sampleCount >= limit,
    };
  }

  async attributeKeys(input: AttributeKeysInput): Promise<AttributeKey[]> {
    const where = buildProfileWhere({ timeRange: input.timeRange, attributes: [] });
    // One scan per source, each capped on its own, so a wide sample attribute
    // set cannot crowd out the resource keys.
    const selects = PROFILES_ATTRIBUTE_SOURCES.map(
      (source) => /* sql */ `
        SELECT key, '${source}' AS source FROM (
          SELECT DISTINCT arrayJoin(mapKeys(${profileAttributeColumn(source)})) AS key
          FROM ${this.tableName}
          WHERE ${where.clause}
          ORDER BY key
          LIMIT ${ATTRIBUTE_KEY_LIMIT}
        )
        WHERE key != ''`,
    );
    return this.client.execute<AttributeKey>(selects.join("\n        UNION ALL"), where.params);
  }

  async attributeValues(input: AttributeValuesInput): Promise<string[]> {
    const where = buildProfileWhere({ timeRange: input.timeRange, attributes: [] });
    const column = profileAttributeColumn(input.source);
    const search = input.search?.trim();
    const rows = await this.client.execute<{ value: string }>(
      /* sql */ `
      SELECT DISTINCT ${column}[{key:String}] AS value
      FROM ${this.tableName}
      WHERE mapContains(${column}, {key:String})
        AND ${where.clause}${search ? "\n        AND positionCaseInsensitive(value, {search:String}) > 0" : ""}
      ORDER BY value
      LIMIT ${ATTRIBUTE_VALUE_LIMIT}
    `,
      { ...where.params, key: input.key, ...(search ? { search } : {}) },
    );
    return rows.map((row) => row.value).filter((value) => value !== "");
  }
}

function fillBuckets(
  rows: { bucket: string; value: string | number }[],
  fromDate: Date,
  toDate: Date,
  intervalSeconds: number,
): ProfileHistogramBucket[] {
  const values = new Map(rows.map((row) => [bucketMs(row.bucket), Number(row.value)]));
  return bucketStarts(fromDate, toDate, intervalSeconds).map(({ ms, timestamp, endTimestamp }) => ({
    timestamp,
    endTimestamp,
    value: values.get(ms) ?? 0,
  }));
}

export interface ProfilesRepositoryOptions {
  tableName?: string;
}

export type ProfilesRepositoryLike = Pick<
  ProfilesRepository,
  | "listServices"
  | "listSampleTypes"
  | "stacks"
  | "listVersions"
  | "exampleTraces"
  | "histogram"
  | "spanTimeline"
  | "profiledSpans"
  | "attributeKeys"
  | "attributeValues"
>;
