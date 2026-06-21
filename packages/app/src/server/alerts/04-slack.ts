import { truncateWithEllipsis } from "@/lib/truncate";
import {
  type BuildOptions,
  type DeliveryInput,
  formatDuration,
  formatUtc,
  instanceLine,
  KIND_STATUS,
  pushFiringBlock,
  renderDescription,
  renderTitle,
} from "./04-format";

export type SlackBlock = { type: string; [key: string]: unknown };
export interface SlackMessage {
  attachments: { color: string; blocks: SlackBlock[] }[];
}

// Status sidebar colors: red for anything still firing, green when fully resolved.
const SLACK_COLORS: Record<DeliveryInput["kind"], string> = {
  firing: "#dc2626",
  resolved: "#16a34a",
  mixed: "#dc2626",
};

// Slack rejects section text fields longer than this.
const MAX_SECTION_TEXT = 3000;

// Slack parses `&`, `<`, `>` as control characters in mrkdwn (`<!channel>`,
// `<@U…>`, `<url|text>`), so dynamic content must escape them before it is
// embedded — otherwise alert data could trigger mentions or distort the layout.
// https://api.slack.com/reference/surfaces/formatting#escaping
function escapeSlackText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(text: string): string {
  return truncateWithEllipsis(text, MAX_SECTION_TEXT);
}

// Mirrors buildTelegramText's branching (single/multi firing, resolved, mixed),
// rendered as Slack mrkdwn with a bold headline.
function buildBody(input: DeliveryInput, now: Date): string {
  const status = KIND_STATUS[input.kind];
  const lines: string[] = [
    `${status.emoji} *${escapeSlackText(input.def.slug)} ${status.label.toLowerCase()}*`,
  ];

  const firing = input.instances.filter((i) => i.kind !== "resolved");
  const resolved = input.instances.filter((i) => i.kind === "resolved");

  if (input.kind === "firing" && firing.length === 1) {
    const instance = firing[0];
    lines.push("", escapeSlackText(renderTitle(input.def, instance)));
    const description = renderDescription(input.def, instance);
    if (description) lines.push("", `> ${escapeSlackText(description)}`);
    lines.push("", instanceLine(instance, "firing", now, "•", escapeSlackText));
  } else if (input.kind === "firing") {
    lines.push("");
    for (const instance of firing)
      pushFiringBlock(lines, input.def, instance, now, escapeSlackText);
  } else if (input.kind === "resolved") {
    for (const instance of resolved) {
      const duration = instance.firedAt
        ? formatDuration(instance.firedAt, now)
        : "";
      lines.push(
        "",
        duration
          ? `Instance resolved (fired for ${duration})`
          : "Instance resolved",
      );
      lines.push(instanceLine(instance, "resolved", now, "•", escapeSlackText));
    }
  } else {
    if (firing.length > 0) {
      lines.push("", "*Firing:*");
      for (const instance of firing)
        pushFiringBlock(lines, input.def, instance, now, escapeSlackText);
    }
    if (resolved.length > 0) {
      lines.push("", "*Resolved:*");
      for (const instance of resolved)
        lines.push(
          instanceLine(instance, "resolved", now, "•", escapeSlackText),
        );
    }
  }

  return truncate(lines.join("\n"));
}

export function buildSlackMessage(
  input: DeliveryInput,
  opts: BuildOptions,
): SlackMessage {
  return {
    attachments: [
      {
        color: SLACK_COLORS[input.kind],
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: buildBody(input, opts.now) },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: formatUtc(opts.now),
              },
            ],
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "View alert" },
                url: opts.url,
              },
              ...(opts.notebookUrl
                ? [
                    {
                      type: "button",
                      text: { type: "plain_text", text: "View notebook" },
                      url: opts.notebookUrl,
                    },
                  ]
                : []),
            ],
          },
        ],
      },
    ],
  };
}
