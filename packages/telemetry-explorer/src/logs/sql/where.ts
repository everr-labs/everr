import { buildAttributeClauses } from "../../attribute-filter/sql/where";
import type { AttributeFilter, LogLevel } from "../schemas";
import { logsAttributeColumn } from "./attribute-columns";
import { LOG_LEVEL_EXPR } from "./level-expr";

export interface WhereInput {
  query?: string;
  levels: LogLevel[];
  services: string[];
  attributes?: AttributeFilter[];
  traceId?: string;
  includeLevels?: boolean;
}

export interface WhereResult {
  clause: string;
  params: Record<string, unknown>;
}

export function buildWhereClause(input: WhereInput): WhereResult {
  const clauses = [
    "TimestampTime >= parseDateTimeBestEffort({fromTime:String})",
    "TimestampTime <= parseDateTimeBestEffort({toTime:String})",
  ];
  const params: Record<string, unknown> = {};

  if (input.query) {
    clauses.push("positionCaseInsensitive(Body, {query:String}) > 0");
  }
  if (input.includeLevels !== false && input.levels.length > 0) {
    clauses.push(`${LOG_LEVEL_EXPR} IN {levels:Array(String)}`);
  }
  if (input.services.length > 0) {
    clauses.push("ServiceName IN {services:Array(String)}");
  }

  const attr = buildAttributeClauses(input.attributes ?? [], logsAttributeColumn);
  clauses.push(...attr.clauses);
  Object.assign(params, attr.params);

  if (input.traceId) {
    clauses.push("TraceId = {traceId:String}");
  }

  return { clause: clauses.join("\n      AND "), params };
}
