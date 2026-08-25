import type { AlertingRuleCondition } from "../types";

export function alertingConditionValue(
  row: Record<string, unknown>,
): number | null {
  const raw = row.value;
  if (raw === null || raw === undefined || typeof raw === "boolean")
    return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function alertingConditionMatches(
  row: Record<string, unknown>,
  condition: AlertingRuleCondition,
): boolean {
  const value = alertingConditionValue(row);
  if (value === null) return false;

  switch (condition.operator) {
    case "gt":
      return value > condition.threshold;
    case "gte":
      return value >= condition.threshold;
    case "lt":
      return value < condition.threshold;
    case "lte":
      return value <= condition.threshold;
    case "eq":
      return value === condition.threshold;
    case "neq":
      return value !== condition.threshold;
  }
}

export function alertingConditionOperatorLabel(
  operator: AlertingRuleCondition["operator"],
): string {
  return {
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    eq: "=",
    neq: "!=",
  }[operator];
}
