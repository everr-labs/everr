import { describe, expect, it } from "vitest";
import { buildSlackMessage, type SlackMessage } from "./04-slack";

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

function sectionText(msg: SlackMessage): string {
  const block = msg.attachments[0].blocks.find(
    (b) => b.type === "section",
  ) as unknown as {
    text: { text: string };
  };
  return block.text.text;
}

describe("buildSlackMessage", () => {
  it("renders a firing message with a red attachment and a link button", () => {
    const msg = buildSlackMessage(
      {
        def,
        kind: "firing",
        instances: [{ labels: { route: "/a" }, kind: "firing" }],
      },
      opts,
    );
    expect(msg.attachments[0].color).toBe("#dc2626");
    expect(sectionText(msg)).toContain("*s1 firing*");
    expect(sectionText(msg)).toContain("• route=/a");
    const actions = msg.attachments[0].blocks.find(
      (b) => b.type === "actions",
    ) as unknown as {
      elements: { url: string; text: { text: string } }[];
    };
    expect(actions.elements[0]).toMatchObject({
      url: opts.url,
      text: { text: "View alert" },
    });
  });

  it("uses a green attachment for resolved messages", () => {
    const msg = buildSlackMessage(
      {
        def,
        kind: "resolved",
        instances: [
          {
            labels: { route: "/a" },
            firedAt: new Date("2026-06-12T11:18:00Z"),
            kind: "resolved",
          },
        ],
      },
      opts,
    );
    expect(msg.attachments[0].color).toBe("#16a34a");
    expect(sectionText(msg)).toContain("fired for 42m");
  });

  it("escapes Slack control characters in dynamic content", () => {
    const msg = buildSlackMessage(
      {
        def: { ...def, notificationTitleTemplate: `\${title}` },
        kind: "firing",
        instances: [
          {
            labels: { route: "<!channel>" },
            row: { title: "<@U123> & <https://evil|click>" },
            kind: "firing",
          },
        ],
      },
      opts,
    );
    const text = sectionText(msg);
    expect(text).toContain("&lt;!channel&gt;");
    expect(text).toContain("&lt;@U123&gt; &amp; &lt;https://evil|click&gt;");
    expect(text).not.toContain("<!channel>");
    expect(text).not.toContain("<@U123>");
  });

  it("truncates very long section text", () => {
    const msg = buildSlackMessage(
      {
        def: { ...def, notificationDescriptionTemplate: "x".repeat(4000) },
        kind: "firing",
        instances: [{ labels: { route: "/a" }, kind: "firing" }],
      },
      opts,
    );
    expect(sectionText(msg).length).toBeLessThanOrEqual(3000);
  });

  it("adds a View notebook button when notebookUrl is present", () => {
    const msg = buildSlackMessage(
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
    const actions = msg.attachments[0].blocks.find(
      (b) => b.type === "actions",
    ) as unknown as { elements: { url: string; text: { text: string } }[] };
    expect(actions.elements).toHaveLength(2);
    expect(actions.elements[1]).toMatchObject({
      url: "https://app.example.com/notebooks/default/runbook",
      text: { text: "View notebook" },
    });
  });

  it("has only the alert button when notebookUrl is absent", () => {
    const msg = buildSlackMessage(
      {
        def,
        kind: "firing",
        instances: [{ labels: { route: "/a" }, kind: "firing" }],
      },
      opts,
    );
    const actions = msg.attachments[0].blocks.find(
      (b) => b.type === "actions",
    ) as unknown as { elements: unknown[] };
    expect(actions.elements).toHaveLength(1);
  });
});
