import {
  resourceAttribute,
  resourceAttributeKeyExists,
} from "../../sql/resource-attributes";
import type { LogLevel } from "../schemas";
import { LOG_LEVEL_EXPR } from "./level-expr";

const REPOSITORY_RESOURCE_ATTRIBUTE = "vcs.repository.name";

export interface WhereInput {
  query?: string;
  levels: LogLevel[];
  services: string[];
  repos: string[];
  traceId?: string;
  includeLevels?: boolean;
}

export function buildWhereClause(input: WhereInput): string {
  const clauses = [
    "TimestampTime >= parseDateTimeBestEffort({fromTime:String})",
    "TimestampTime <= parseDateTimeBestEffort({toTime:String})",
  ];
  if (input.query) {
    clauses.push("positionCaseInsensitive(Body, {query:String}) > 0");
  }
  if (input.includeLevels !== false && input.levels.length > 0) {
    clauses.push(`${LOG_LEVEL_EXPR} IN {levels:Array(String)}`);
  }
  if (input.services.length > 0) {
    clauses.push("ServiceName IN {services:Array(String)}");
  }
  if (input.repos.length > 0) {
    const repoFilter = `${resourceAttribute(REPOSITORY_RESOURCE_ATTRIBUTE)} IN {repos:Array(String)}`;
    clauses.push(
      input.repos.includes("")
        ? repoFilter
        : `${resourceAttributeKeyExists(REPOSITORY_RESOURCE_ATTRIBUTE)} AND ${repoFilter}`,
    );
  }
  if (input.traceId) {
    clauses.push("TraceId = {traceId:String}");
  }
  return clauses.join("\n      AND ");
}
