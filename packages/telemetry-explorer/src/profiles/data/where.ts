import { resolveTimeRange } from "@everr/ui/lib/time-range";
import type { AttributeSource } from "../../attribute-filter/schemas";
import type { ProfileFilterInput } from "./schemas";

// The exporter writes profile attributes as maps, not the JSON columns of logs
// and traces, so these predicates read `map[key]` and `mapContains`, which the
// table's bloom filters on mapKeys/mapValues prune.
export function profileAttributeColumn(source: AttributeSource): string {
  switch (source) {
    case "resource":
      return "ResourceAttributes";
    case "sample":
      return "SampleAttributes";
    case "log":
    case "scope":
    case "span":
      throw new Error(`profiles have no ${source} attributes`);
  }
}

// Server-fn inputs arrive before zod fills `values` in.
type ProfileAttributeFilter = NonNullable<ProfileFilterInput["attributes"]>[number];

type BuiltWhere = { clause: string; params: Record<string, unknown> };

/** The filters every profiles query shares; with a sample type, only samples of it. */
export function buildProfileWhere(
  input: ProfileFilterInput & { sampleType?: string; sampleUnit?: string },
): BuiltWhere {
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const clauses = [
    "Timestamp >= parseDateTime64BestEffort({fromTime:String}, 9)",
    "Timestamp <= parseDateTime64BestEffort({toTime:String}, 9)",
  ];
  const params: Record<string, unknown> = { fromTime: fromISO, toTime: toISO };

  if (input.sampleType !== undefined && input.sampleUnit !== undefined) {
    clauses.push("SampleType = {sampleType:String} AND SampleUnit = {sampleUnit:String}");
    params.sampleType = input.sampleType;
    params.sampleUnit = input.sampleUnit;
  }

  const services = input.services ?? [];
  if (services.length > 0) {
    clauses.push("ServiceName IN {services:Array(String)}");
    params.services = services;
  }
  const versions = input.versions ?? [];
  if (versions.length > 0) {
    clauses.push("ResourceAttributes['service.version'] IN {versions:Array(String)}");
    params.versions = versions;
  }
  if (input.traceId) {
    clauses.push("TraceId = {traceId:String}");
    params.traceId = input.traceId;
  }
  if (input.spanId) {
    clauses.push("SpanId = {spanId:String}");
    params.spanId = input.spanId;
  }
  const q = input.q?.trim();
  if (q) {
    // A sample matches when any frame of its stack does, so the flame graph
    // keeps the callers and callees around the searched function.
    clauses.push("arrayExists(f -> positionCaseInsensitive(f, {q:String}) > 0, FunctionNames)");
    params.q = q;
  }
  (input.attributes ?? []).forEach((filter, index) => {
    const clause = attributeClause(filter, index, params);
    if (clause) clauses.push(clause);
  });

  return { clause: clauses.join("\n        AND "), params };
}

export function attributeClause(
  filter: ProfileAttributeFilter,
  index: number,
  params: Record<string, unknown>,
): string | undefined {
  const column = profileAttributeColumn(filter.source);
  const keyParam = `attrKey${index}`;
  const valsParam = `attrVals${index}`;
  const exists = `mapContains(${column}, {${keyParam}:String})`;
  const value = `${column}[{${keyParam}:String}]`;
  const values = filter.values ?? [];
  switch (filter.op) {
    case "in":
      if (values.length === 0) return undefined;
      params[keyParam] = filter.key;
      params[valsParam] = values;
      return `${exists} AND ${value} IN {${valsParam}:Array(String)}`;
    case "not_in":
      // Present with another value, as on the other Explore pages; `missing`
      // covers absence.
      if (values.length === 0) return undefined;
      params[keyParam] = filter.key;
      params[valsParam] = values;
      return `(${exists} AND ${value} NOT IN {${valsParam}:Array(String)})`;
    case "exists":
      params[keyParam] = filter.key;
      return exists;
    case "missing":
      params[keyParam] = filter.key;
      return `NOT ${exists}`;
  }
}
