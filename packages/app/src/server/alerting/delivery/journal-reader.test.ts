import { QueryBuilder } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {}, pool: {} }));

import type { DbExecutor } from "@/db/client";
import {
  deliverableEventQuery,
  deliverableGroupMemberQuery,
  linkedEventsForDeliveryQuery,
  liveRuleForDeliveryQuery,
} from "./journal-reader";

// The pipeline never enqueues a state-only event for delivery, so no
// end-to-end test can see this filter drop one. It is the module's stated
// guarantee all the same, and this is the only level that can prove it: a
// detached builder renders the exact SQL the reader would execute.
const builder = () => new QueryBuilder() as unknown as DbExecutor;

const eventId = "0ee52a7c-c9d7-4bca-9c67-a21db2096acf";

describe("the delivery pipeline's journal boundary", () => {
  it("pins every read to notifying events, so no state-only row can be delivered", () => {
    const reads = [
      deliverableEventQuery(builder(), eventId),
      deliverableGroupMemberQuery(builder(), eventId, 500),
      linkedEventsForDeliveryQuery(builder(), "org-1", "dk-1"),
      liveRuleForDeliveryQuery(builder(), "dk-1"),
    ];

    for (const read of reads) {
      const { sql, params } = read.toSQL();
      expect(sql).toContain('"kind" = ');
      expect(params).toContain("notifying");
    }
  });
});
