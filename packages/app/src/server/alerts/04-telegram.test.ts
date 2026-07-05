import { describe, expect, it } from "vite-plus/test";
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

  it("does not split a surrogate pair when truncating the body", () => {
    // 😀 is U+1F600 (two UTF-16 units). Force the body to overrun so the
    // truncation boundary falls on the emoji's high surrogate.
    const instances = Array.from({ length: 80 }, (_, i) => ({
      labels: { route: `/route-${i}-${"x".repeat(40)}` },
      kind: "firing" as const,
    }));
    const emojiBody = `${"x".repeat(3800)}😀${"y".repeat(200)}`;
    const text = buildTelegramText(
      {
        def: { ...def, notificationDescriptionTemplate: emojiBody },
        kind: "firing",
        instances,
      },
      opts,
    );
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text.endsWith(opts.url)).toBe(true);
    // No lone surrogate anywhere in the output.
    for (let i = 0; i < text.length; i++) {
      const u = text.charCodeAt(i);
      if (u >= 0xd800 && u <= 0xdbff) {
        expect(text.charCodeAt(i + 1)).toBeGreaterThanOrEqual(0xdc00);
        expect(text.charCodeAt(i + 1)).toBeLessThanOrEqual(0xdfff);
        i++;
      } else {
        expect(u < 0xd800 || u > 0xdfff).toBe(true);
      }
    }
  });

  it("includes the runbook link when runbookUrl is present", () => {
    const text = buildTelegramText(
      {
        def,
        kind: "firing",
        instances: [{ labels: { route: "/a" }, kind: "firing" }],
      },
      {
        ...opts,
        runbookUrl: "https://app.example.com/runbooks/default/runbook",
      },
    );
    expect(text).toContain("Runbook: https://app.example.com/runbooks/default/runbook");
  });

  it("omits the runbook line when runbookUrl is absent", () => {
    const text = buildTelegramText(
      {
        def,
        kind: "firing",
        instances: [{ labels: { route: "/a" }, kind: "firing" }],
      },
      opts,
    );
    expect(text).not.toContain("Runbook:");
  });
});
