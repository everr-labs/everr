import { describe, expect, it } from "vitest";
import { buildInvestigationEvent } from "./events";

describe("buildInvestigationEvent", () => {
  it("shapes an investigation as a log event in the everr.error.* namespace", () => {
    const event = buildInvestigationEvent({
      fingerprint: "fp-1",
      markdown: "## Findings\nNull deref in retry path.",
      author: { id: "user-1", name: "Ada Lovelace" },
    });

    expect(event).toEqual({
      serviceName: "everr-triage",
      body: "## Findings\nNull deref in retry path.",
      attributes: {
        "everr.error.event": "investigation",
        "everr.error.fingerprint": "fp-1",
        "everr.error.author.id": "user-1",
        "everr.error.author.name": "Ada Lovelace",
      },
    });
  });
});
