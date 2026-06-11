import { querySqlApiWithMeta, type SqlApiResult } from "@/lib/clickhouse";
import { type AlertRuleYaml, AlertRuleYamlSchema } from "./schema";
import {
  validateMessageTemplate,
  validateQueryTemplate,
  validateTopColumns,
} from "./template";
import { parseEvaluationInterval } from "./window";

// One validation pipeline for alert rules, shared by `everr apply`
// (apply.server.ts) and `everr alerts test` (routes/api/cli/alerts/test.ts) so
// the two can never accept different rule sets.
export class AlertRuleValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.path = path;
  }
}

export interface ParsedAlertRule {
  rule: AlertRuleYaml;
  slug: string;
  evaluationIntervalSeconds: number;
}

export interface AlertRuleQueryValidation {
  queryResult: SqlApiResult<Record<string, unknown>>;
  instanceLabelColumns: string[];
}

function fail(path: string, error: unknown): never {
  throw new AlertRuleValidationError(
    path,
    error instanceof Error ? error.message : String(error),
  );
}

// Static validation: schema, evaluation interval, template syntax. No I/O.
export function parseAlertRule(
  path: string,
  resource: unknown,
): ParsedAlertRule {
  const parsed = AlertRuleYamlSchema.safeParse(resource);
  if (!parsed.success) {
    throw new AlertRuleValidationError(
      path,
      `invalid alert rule: ${parsed.error.issues[0]?.message ?? "invalid alert rule"}`,
    );
  }

  const rule = parsed.data;
  let evaluationIntervalSeconds: number;
  try {
    evaluationIntervalSeconds = parseEvaluationInterval(
      rule.spec.evaluationInterval,
    );
    validateQueryTemplate(rule.spec.query);
    validateMessageTemplate(rule.spec.summary);
    if (rule.spec.description) validateMessageTemplate(rule.spec.description);
  } catch (error) {
    fail(path, error);
  }

  return { rule, slug: rule.metadata.name, evaluationIntervalSeconds };
}

// Result-dependent validation: run the rule's query against the org's data and
// check template/instance-label columns against the result schema.
export async function validateAlertRuleQuery(
  path: string,
  rule: AlertRuleYaml,
  organizationId: string,
): Promise<AlertRuleQueryValidation> {
  let queryResult: SqlApiResult<Record<string, unknown>>;
  try {
    queryResult = await querySqlApiWithMeta<Record<string, unknown>>(
      rule.spec.query,
      organizationId,
    );
  } catch (error) {
    throw new AlertRuleValidationError(
      path,
      `query failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    validateTopColumns(rule.spec.summary, queryResult.columns);
    if (rule.spec.description) {
      validateTopColumns(rule.spec.description, queryResult.columns);
    }
  } catch (error) {
    fail(path, error);
  }

  const instanceLabelColumns = rule.spec.instanceLabels ?? [];
  const columnNames = new Set(queryResult.columns);
  for (const column of instanceLabelColumns) {
    if (!columnNames.has(column)) {
      throw new AlertRuleValidationError(
        path,
        `instanceLabels references column "${column}" which the query does not return`,
      );
    }
  }

  return { queryResult, instanceLabelColumns };
}
