import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ALERTING_LIFECYCLE_REASONS } from "@/data/alerting/vocabulary";
import { alertEvents, alertEventTypeEnum } from "./alerts";

const dialect = new PgDialect();

function checkSql(name: string): string {
  const check = getTableConfig(alertEvents).checks.find((c) => c.name === name);
  if (!check) throw new Error(`check not found: ${name}`);
  return dialect.sqlToQuery(check.value).sql;
}

// The CHECK is generated from the vocabulary export, so this guards the
// generation itself: a reason added to the vocabulary without regenerating
// the check would otherwise fail silently.
describe("alert_events_reason_in_vocabulary", () => {
  it("admits the empty string and every vocabulary reason", () => {
    const sql = checkSql("alert_events_reason_in_vocabulary");
    expect(sql).toContain("''");
    for (const reason of ALERTING_LIFECYCLE_REASONS) {
      expect(sql).toContain(`'${reason}'`);
    }
  });
});

// delivery, rule_health and silenced had no writer anywhere and the table
// migration that introduced the enum leaves no legacy data behind them.
describe("alert_event_type enum", () => {
  it("carries no dead event types", () => {
    expect(alertEventTypeEnum.enumValues).not.toContain("delivery");
    expect(alertEventTypeEnum.enumValues).not.toContain("rule_health");
    expect(alertEventTypeEnum.enumValues).not.toContain("silenced");
  });
});
