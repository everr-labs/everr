import { describe, expect, it, vi } from "vitest";

// formatNotification is pure; the mock only keeps the module import from
// reaching the real database client.
vi.mock("@/db/client", () => ({ db: {}, pool: {} }));

import { formatNotification, type NotificationEvent } from "./flush-group";

// The sender composes title + body + optional URL into one Discord message
// whose hard limit is 2000 characters; the body must leave room for the rest.
const DISCORD_CONTENT_LIMIT = 2000;

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    eventType: "instance_fired",
    slug: "default/high-5xx",
    instanceLabels: { host: "web-1" },
    notificationTitle: "",
    notificationDescription: "",
    ...overrides,
  };
}

describe("formatNotification", () => {
  it("keeps a small group byte for byte", () => {
    const events = [
      event(),
      event({ eventType: "instance_resolved", slug: "default/latency" }),
    ];
    expect(formatNotification(events)).toEqual({
      title: "Everr alert: 1 firing, 1 resolved",
      body: "Firing: default/high-5xx (host=web-1)\nResolved: default/latency (host=web-1)",
    });
  });

  it("cuts a large group to a bounded body and says how many were cut", () => {
    const events = Array.from({ length: 300 }, (_, i) =>
      event({ instanceLabels: { host: `web-${i}` } }),
    );
    const { title, body } = formatNotification(events);
    expect(title).toBe("Everr alert: 300 firing");
    const lines = body.split("\n");
    expect(lines.at(-1)).toMatch(/^…and \d+ more events in this group$/);
    const shown = lines.length - 1;
    expect(shown).toBeLessThanOrEqual(20);
    expect(lines.at(-1)).toBe(`…and ${300 - shown} more events in this group`);
    expect(body.length).toBeLessThan(DISCORD_CONTENT_LIMIT - title.length - 4);
  });

  it("caps one pathological event so it cannot eat the budget", () => {
    const events = [
      event({
        notificationDescription: "x".repeat(10_000),
        instanceLabels: { host: "web-1", region: "y".repeat(5_000) },
      }),
      event({ slug: "default/second" }),
    ];
    const { body } = formatNotification(events);
    const lines = body.split("\n");
    expect(lines[0]?.length).toBeLessThanOrEqual(200);
    expect(lines[0]?.endsWith("…")).toBe(true);
    // The huge first event must not push the second one out.
    expect(lines[1]).toBe("Firing: default/second (host=web-1)");
    expect(body.length).toBeLessThan(500);
  });

  it("counts every event in the title even when lines are cut", () => {
    const events = [
      ...Array.from({ length: 50 }, (_, i) =>
        event({ instanceLabels: { host: `web-${i}` } }),
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        event({
          eventType: "instance_resolved",
          instanceLabels: { host: `web-${i}` },
        }),
      ),
    ];
    expect(formatNotification(events).title).toBe(
      "Everr alert: 50 firing, 30 resolved",
    );
  });
});
