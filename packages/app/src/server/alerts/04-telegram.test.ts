import { describe, expect, it } from "vitest";
import { buildTelegramText } from "./04-telegram";

const def = {
  id: "a1",
  organizationId: "org-1",
  repoid: "r1",
  slug: "s1",
  notificationTitleTemplate: "Error rate high",
  notificationDescriptionTemplate: "",
};
const opts = {
  url: "https://app.example.com/alerts/a1",
  now: new Date("2026-06-12T12:00:00Z"),
};

describe("buildTelegramText", () => {
  it("renders a single firing instance with the footer link", () => {
    const text = buildTelegramText(
      {
        def,
        kind: "firing",
        instances: [{ labels: { route: "/a" }, kind: "firing" }],
      },
      opts,
    );
    expect(text).toContain("🔥 s1 firing");
    expect(text).toContain("• route=/a");
    expect(text).toContain(`Alert: ${opts.url}`);
    expect(text.endsWith(opts.url)).toBe(true);
  });

  it("caps a noisy evaluation at Telegram's limit while keeping the footer", () => {
    const instances = Array.from({ length: 500 }, (_, i) => ({
      labels: { route: `/route-${i}-${"x".repeat(40)}` },
      kind: "firing" as const,
    }));
    const text = buildTelegramText({ def, kind: "firing", instances }, opts);
    expect(text.length).toBeLessThanOrEqual(4096);
    // The footer (timestamp + link) survives the truncation.
    expect(text).toContain(`Alert: ${opts.url}`);
    expect(text.endsWith(opts.url)).toBe(true);
  });

  it("includes the notebook link when notebookUrl is present", () => {
    const text = buildTelegramText(
      {
        def,
        kind: "firing",
        instances: [{ labels: { route: "/a" }, kind: "firing" }],
      },
      {
        ...opts,
        notebookUrl: "https://app.example.com/notebooks/default/runbook",
      },
    );
    expect(text).toContain(
      "Notebook: https://app.example.com/notebooks/default/runbook",
    );
  });

  it("omits the notebook line when notebookUrl is absent", () => {
    const text = buildTelegramText(
      {
        def,
        kind: "firing",
        instances: [{ labels: { route: "/a" }, kind: "firing" }],
      },
      opts,
    );
    expect(text).not.toContain("Notebook:");
  });
});
