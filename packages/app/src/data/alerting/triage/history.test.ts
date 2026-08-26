import { describe, expect, it } from "vitest";
import { lifecycleLine } from "./history";

describe("lifecycleLine", () => {
  it("keeps the engine's event name and appends only what the row carries", () => {
    expect(
      lifecycleLine({
        event_type: "instance_resolved",
        event_time: "",
        instance_labels: { service: "checkout", host: "a" },
        reason: "condition_cleared",
        silenced: true,
        error: "",
      }),
    ).toBe(
      "instance_resolved · checkout a · reason condition_cleared · held by silence",
    );
    expect(
      lifecycleLine({
        event_type: "evaluation_failed",
        event_time: "",
        instance_labels: {},
        reason: "",
        silenced: false,
        error: "TIMEOUT",
      }),
    ).toBe("evaluation_failed · TIMEOUT");
  });
});
