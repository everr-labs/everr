import {
  resourceAttribute,
  resourceAttributeKeyExists,
} from "../../sql/resource-attributes";
import type { AttributeFilter, LogLevel } from "../schemas";
import { attributeColumn } from "./attribute-columns";
import { LOG_LEVEL_EXPR } from "./level-expr";

const REPOSITORY_RESOURCE_ATTRIBUTE = "vcs.repository.name";

export interface WhereInput {
  query?: string;
  levels: LogLevel[];
  services: string[];
  repos?: string[];
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
  if (input.repos && input.repos.length > 0) {
    const repoFilter = `${resourceAttribute(REPOSITORY_RESOURCE_ATTRIBUTE)} IN {repos:Array(String)}`;
    clauses.push(
      input.repos.includes("")
        ? repoFilter
        : `${resourceAttributeKeyExists(REPOSITORY_RESOURCE_ATTRIBUTE)} AND ${repoFilter}`,
    );
  }

  (input.attributes ?? []).forEach((filter, index) => {
    const column = attributeColumn(filter.source);
    const keyParam = `attrKey${index}`;
    const valsParam = `attrVals${index}`;
    const contains = `mapContains(${column}, {${keyParam}:String})`;
    const access = `${column}[{${keyParam}:String}]`;
    params[keyParam] = filter.key;

    switch (filter.op) {
      case "in":
        clauses.push(
          `${contains} AND ${access} IN {${valsParam}:Array(String)}`,
        );
        params[valsParam] = filter.values;
        break;
      case "not_in":
        clauses.push(
          `(NOT ${contains} OR ${access} NOT IN {${valsParam}:Array(String)})`,
        );
        params[valsParam] = filter.values;
        break;
      case "exists":
        clauses.push(contains);
        break;
      case "missing":
        clauses.push(`NOT ${contains}`);
        break;
    }
  });

  if (input.traceId) {
    clauses.push("TraceId = {traceId:String}");
  }

  return { clause: clauses.join("\n      AND "), params };
}
