import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {}, pool: {} }));

import { rollupAlertState } from "./repository";

// Finding 11: everything except firing used to collapse to inactive, which
// made the Pending state unreachable in every list and detail view.
describe("rollupAlertState", () => {
  it("covers inactive, pending, firing, and resolved", () => {
    expect(rollupAlertState("unknown")).toBe("inactive");
    expect(rollupAlertState("resolved")).toBe("inactive");
    expect(rollupAlertState("pending")).toBe("pending");
    expect(rollupAlertState("firing")).toBe("firing");
  });
});
