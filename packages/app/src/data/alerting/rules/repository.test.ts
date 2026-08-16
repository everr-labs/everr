import { describe, expect, it, vi } from "vitest";

// Only so that importing `./repository` for the pure function below does not
// build a real database pool. Nothing here answers a query: every mutation
// this module exports is covered against a real PostgreSQL by the pipeline
// integration suite.
vi.mock("@/db/client", () => ({
  db: {},
  pool: {},
  runInTransaction: () => Promise.resolve(),
}));

import { rollupAlertState } from "./repository";

// The rollup must pass `pending` through: collapsing everything but firing to
// inactive makes the Pending state unreachable in every list and detail view.
describe("rollupAlertState", () => {
  it("covers inactive, pending, firing, and resolved", () => {
    expect(rollupAlertState("unknown")).toBe("inactive");
    expect(rollupAlertState("resolved")).toBe("inactive");
    expect(rollupAlertState("pending")).toBe("pending");
    expect(rollupAlertState("firing")).toBe("firing");
  });
});
