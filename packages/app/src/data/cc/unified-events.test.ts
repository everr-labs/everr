import { describe, expect, it } from "vitest";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import type { CcEvent } from "./types";
import {
  CC_UNIFIED_EVENTS_CAP,
  ccEventDedupKey,
  historyToUnified,
  liveToUnified,
  mergeCcEvents,
} from "./unified-events";

function liveEvent(overrides: Partial<CcEvent> = {}): CcEvent {
  return {
    tenant: "org1",
    rule: "5a1e8d6a-0000-0000-0000-000000000000",
    instance_key: "fp1",
    status: "firing",
    labels: { host: "web-1" },
    value: 1,
    severity: "critical",
    annotations: {},
    eval_ts: "2026-06-10T12:00:00.000Z",
    ...overrides,
  };
}

function historyRow(
  overrides: Partial<AlertEventLogRow> = {},
): AlertEventLogRow {
  return {
    timestamp: "2026-06-10T12:00:00Z",
    eventType: "instance_fired",
    slug: "high-5xx",
    instanceFingerprint: "fp1",
    labels: { host: "web-1" },
    severity: "",
    suppressed: false,
    silenced: false,
    deliveryTargets: [],
    evidence: null,
    ...overrides,
  };
}

describe("ccEventDedupKey", () => {
  it("floors timestamps to whole seconds so SSE millis match stored seconds", () => {
    expect(
      ccEventDedupKey("fp1", "2026-06-10T12:00:00.734Z", "instance_fired"),
    ).toBe(ccEventDedupKey("fp1", "2026-06-10T12:00:00Z", "instance_fired"));
  });

  it("separates different fingerprints, seconds, and event types", () => {
    const base = ccEventDedupKey(
      "fp1",
      "2026-06-10T12:00:00Z",
      "instance_fired",
    );
    expect(
      ccEventDedupKey("fp2", "2026-06-10T12:00:00Z", "instance_fired"),
    ).not.toBe(base);
    expect(
      ccEventDedupKey("fp1", "2026-06-10T12:00:01Z", "instance_fired"),
    ).not.toBe(base);
    expect(
      ccEventDedupKey("fp1", "2026-06-10T12:00:00Z", "instance_resolved"),
    ).not.toBe(base);
  });

  it("keeps an unparseable timestamp verbatim instead of collapsing to one bucket", () => {
    expect(ccEventDedupKey("fp1", "garbage-a", "delivery")).not.toBe(
      ccEventDedupKey("fp1", "garbage-b", "delivery"),
    );
  });
});

describe("liveToUnified", () => {
  it("maps firing/resolved onto the stored event_type vocabulary", () => {
    expect(liveToUnified(liveEvent()).eventType).toBe("instance_fired");
    expect(liveToUnified(liveEvent({ status: "resolved" })).eventType).toBe(
      "instance_resolved",
    );
  });

  it("maps rule_health kind regardless of status and drops the status badge", () => {
    const u = liveToUnified(liveEvent({ kind: "rule_health" }));
    expect(u.eventType).toBe("rule_health");
    expect(u.status).toBeNull();
  });

  it("prefers the everr.name annotation as the rule handle, falling back to the id", () => {
    expect(
      liveToUnified(liveEvent({ annotations: { "everr.name": "high-5xx" } }))
        .rule,
    ).toBe("high-5xx");
    expect(liveToUnified(liveEvent()).rule).toBe(
      "5a1e8d6a-0000-0000-0000-000000000000",
    );
  });

  it("is marked live and carries severity", () => {
    const u = liveToUnified(liveEvent());
    expect(u.source).toBe("live");
    expect(u.severity).toBe("critical");
  });
});

describe("historyToUnified", () => {
  it("derives the status badge only for instance transitions", () => {
    expect(historyToUnified(historyRow()).status).toBe("firing");
    expect(
      historyToUnified(historyRow({ eventType: "instance_resolved" })).status,
    ).toBe("resolved");
    expect(
      historyToUnified(historyRow({ eventType: "delivery" })).status,
    ).toBeNull();
    expect(
      historyToUnified(historyRow({ eventType: "rule_health" })).status,
    ).toBeNull();
  });

  it("maps empty severity to null and keeps a stamped one", () => {
    expect(historyToUnified(historyRow()).severity).toBeNull();
    expect(historyToUnified(historyRow({ severity: "warning" })).severity).toBe(
      "warning",
    );
  });

  it("is marked history and keyed on fingerprint/timestamp/event type", () => {
    const u = historyToUnified(historyRow());
    expect(u.source).toBe("history");
    expect(u.key).toBe(
      ccEventDedupKey("fp1", "2026-06-10T12:00:00Z", "instance_fired"),
    );
  });
});

describe("mergeCcEvents", () => {
  it("drops a stored row whose identity also arrived over SSE (live wins)", () => {
    const live = [
      liveToUnified(liveEvent({ eval_ts: "2026-06-10T12:00:00.734Z" })),
    ];
    const hist = [historyToUnified(historyRow())]; // same fp/second/type
    const merged = mergeCcEvents(live, hist);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("live");
    expect(merged[0].severity).toBe("critical");
  });

  it("keeps stored rows with a different second, type, or fingerprint", () => {
    const live = [liveToUnified(liveEvent())];
    const hist = [
      historyToUnified(historyRow({ timestamp: "2026-06-10T11:59:59Z" })),
      historyToUnified(historyRow({ eventType: "instance_resolved" })),
      historyToUnified(historyRow({ instanceFingerprint: "fp2" })),
    ];
    expect(mergeCcEvents(live, hist)).toHaveLength(4);
  });

  it("does not collapse same-key rows within one source (delivery fan-out)", () => {
    const hist = [
      historyToUnified(historyRow({ eventType: "delivery" })),
      historyToUnified(historyRow({ eventType: "delivery" })),
    ];
    expect(mergeCcEvents([], hist)).toHaveLength(2);
  });

  it("sorts the merged list newest-first across sources", () => {
    const live = [
      liveToUnified(liveEvent({ eval_ts: "2026-06-10T12:00:05Z" })),
    ];
    const hist = [
      historyToUnified(historyRow({ timestamp: "2026-06-10T12:00:10Z" })),
      historyToUnified(historyRow({ timestamp: "2026-06-10T12:00:01Z" })),
    ];
    expect(mergeCcEvents(live, hist).map((e) => e.ts)).toEqual([
      "2026-06-10T12:00:10Z",
      "2026-06-10T12:00:05Z",
      "2026-06-10T12:00:01Z",
    ]);
  });

  it("caps the merged list at the newest rows (default 700)", () => {
    const hist = Array.from({ length: 30 }, (_, i) =>
      historyToUnified(
        historyRow({
          instanceFingerprint: `fp${i}`,
          timestamp: `2026-06-10T12:00:${String(i % 60).padStart(2, "0")}Z`,
        }),
      ),
    );
    const merged = mergeCcEvents([], hist, 10);
    expect(merged).toHaveLength(10);
    // The newest 10 survive.
    expect(merged[0].ts).toBe("2026-06-10T12:00:29Z");
    expect(merged[9].ts).toBe("2026-06-10T12:00:20Z");
    expect(CC_UNIFIED_EVENTS_CAP).toBe(700);
  });
});
