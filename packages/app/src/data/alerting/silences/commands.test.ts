import { describe, expect, it } from "vitest";
import {
  cancelSilenceById,
  cancelSilenceTarget,
  newSilenceSeed,
  recreateCancelledSilence,
  repeatSilenceSeed,
  ruleSilenceSeed,
} from "./commands";

const NOW = new Date("2026-09-04T12:00:00Z").getTime();

describe("Silence create and repeat commands", () => {
  it("starts blank when no rule is known and scoped when one is", () => {
    expect(newSilenceSeed()).toEqual({
      rule: null,
      matchers: "",
      comment: "",
    });
    expect(ruleSilenceSeed("default/latency")).toEqual({
      rule: "default/latency",
      matchers: "",
      comment: "",
    });
  });

  it("repeats the original rule, scope, and comment", () => {
    expect(
      repeatSilenceSeed(
        {
          rule: { path: "payments/latency" },
          scope: "host=web-1",
          comment: "deploying",
        },
        "default/fallback",
      ),
    ).toEqual({
      rule: "payments/latency",
      matchers: "host=web-1",
      comment: "deploying",
    });
  });

  it("uses the detail rule only when the original named no single rule", () => {
    expect(
      repeatSilenceSeed(
        { rule: null, scope: "host=web-1", comment: "deploying" },
        "default/latency",
      ),
    ).toEqual({
      rule: "default/latency",
      matchers: "host=web-1",
      comment: "deploying",
    });
  });
});

describe("Silence cancel commands", () => {
  const record = {
    id: "silence-1",
    startsAt: "2026-09-04T11:00:00Z",
    endsAt: "2026-09-04T12:30:30Z",
    rule: { path: "default/latency" },
    scope: "host=web-1",
    comment: "deploying",
  };

  it("recreates the remaining open window and rounds up a partial minute", () => {
    const target = cancelSilenceTarget(record, "API latency");

    expect(recreateCancelledSilence(target, NOW)).toEqual({
      path: "default/latency",
      durationMinutes: 31,
      matchers: "host=web-1",
      comment: "deploying",
    });
  });

  it("offers no recreation for an unknown scope or a future window", () => {
    expect(
      recreateCancelledSilence(
        cancelSilenceById("silence-1", "API latency"),
        NOW,
      ),
    ).toBeNull();
    expect(
      recreateCancelledSilence(
        cancelSilenceTarget(
          {
            ...record,
            startsAt: "2026-09-04T13:00:00Z",
            endsAt: "2026-09-04T14:00:00Z",
          },
          "API latency",
        ),
        NOW,
      ),
    ).toBeNull();
  });

  it("offers no recreation after the original window has closed", () => {
    expect(
      recreateCancelledSilence(
        cancelSilenceTarget(
          { ...record, endsAt: "2026-09-04T11:59:59Z" },
          "API latency",
        ),
        NOW,
      ),
    ).toBeNull();
  });
});
