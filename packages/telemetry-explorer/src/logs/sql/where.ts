import type { AttributeFilter, LogLevel } from "../schemas";
import { attributeColumn } from "./attribute-columns";
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
  (input.attributes ?? []).forEach((filter, index) => {
    const column = attributeColumn(filter.source);
    const keyParam = `attrKey${index}`;
    const valsParam = `attrVals${index}`;
    const contains = `mapContains(${column}, {${keyParam}:String})`;
    const access = `${column}[{${keyParam}:String}]`;

    switch (filter.op) {
      case "in":
        if (filter.values.length === 0) return;
        params[keyParam] = filter.key;
        clauses.push(
          `${contains} AND ${access} IN {${valsParam}:Array(String)}`,
        );
        params[valsParam] = filter.values;
        break;
      case "not_in":
        if (filter.values.length === 0) return;
        params[keyParam] = filter.key;
        clauses.push(
          `(NOT ${contains} OR ${access} NOT IN {${valsParam}:Array(String)})`,
        );
        params[valsParam] = filter.values;
        break;
      case "exists":
        params[keyParam] = filter.key;
        clauses.push(contains);
        break;
      case "missing":
        params[keyParam] = filter.key;
        clauses.push(`NOT ${contains}`);
        break;
    }
  });

  if (input.traceId) {
    clauses.push("TraceId = {traceId:String}");
  }

  return { clause: clauses.join("\n      AND "), params };
}
