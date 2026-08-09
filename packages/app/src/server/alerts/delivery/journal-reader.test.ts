import { QueryBuilder } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {}, pool: {} }));

import type { DbExecutor } from "@/db/client";
import {
  deliverableEventQuery,
  deliverableGroupMemberQuery,
  liveRuleForDeliveryQuery,
} from "./journal-reader";

// A detached builder renders the exact SQL the reader would execute, so these
// tests pin the boundary itself: the WHERE clause, not a mock's behavior.
const builder = () => new QueryBuilder() as unknown as DbExecutor;

describe("the delivery pipeline's journal boundary", () => {
  it("selects an event for processing only when its kind is notifying", () => {
    const { sql, params } = deliverableEventQuery(
      builder(),
      "0ee52a7c-c9d7-4bca-9c67-a21db2096acf",
    ).toSQL();

    expect(sql).toContain('"alert_events"."kind" = ');
    expect(params).toContain("notifying");
  });

  it("joins group memberships to notifying events only", () => {
    const { sql, params } = deliverableGroupMemberQuery(
      builder(),
      "1af52a7c-c9d7-4bca-9c67-a21db2096acf",
    ).toSQL();

    expect(sql).toContain('"kind" = ');
    expect(params).toContain("notifying");
  });

  it("reads the owning rule's liveness in the same claim", () => {
    const { sql } = deliverableGroupMemberQuery(
      builder(),
      "1af52a7c-c9d7-4bca-9c67-a21db2096acf",
    ).toSQL();

    expect(sql).toContain('left join "alert_definitions"');
    expect(sql).toContain('"active"');
  });

  it("counts a delivery's rules as live only when notifying and active", () => {
    const { sql, params } = liveRuleForDeliveryQuery(builder(), "dk-1").toSQL();

    expect(sql).toContain('"alert_delivery_events"');
    expect(sql).toContain('"kind" = ');
    expect(sql).toContain('"active" = ');
    expect(params).toContain("notifying");
    expect(params).toContain(true);
    expect(params).toContain("dk-1");
  });
});
