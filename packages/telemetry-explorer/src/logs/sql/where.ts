import type { LogLevel } from "../schemas";
import { LOG_LEVEL_EXPR } from "./level-expr";

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
    clauses.push(
      "ResourceAttributes['vcs.repository.name'] IN {repos:Array(String)}",
    );
  }
  if (input.traceId) {
    clauses.push("TraceId = {traceId:String}");
  }
  return clauses.join("\n      AND ");
}
