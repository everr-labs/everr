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

// Telegram rejects sendMessage bodies longer than this.
const MAX_MESSAGE_LENGTH = 4096;

// Truncates the rendered body so body + footer stays under Telegram's limit,
// keeping the footer (timestamp + alert link) intact so the message always
// links back even when a noisy evaluation overruns the cap. The ellipsis sits
// between body and footer; truncateWithEllipsis is surrogate-aware so an
// emoji at the boundary doesn't leave a lone surrogate.
function truncate(body: string, footer: string): string {
  const room = MAX_MESSAGE_LENGTH - footer.length;
  if (body.length <= room) return body + footer;
  return `${truncateWithEllipsis(body, room)}${footer}`;
}

// Plain text by choice: no parse mode means nothing to escape, nothing for
// Telegram to reject, and the URL in the body needs no validation.
export function buildTelegramText(
  input: DeliveryInput,
  opts: BuildOptions,
): string {
  const status = KIND_STATUS[input.kind];
  const lines: string[] = [
    `${status.emoji} ${input.def.slug} ${status.label.toLowerCase()}`,
  ];

  const firing = input.instances.filter((i) => i.kind !== "resolved");
  const resolved = input.instances.filter((i) => i.kind === "resolved");

  if (input.kind === "firing" && firing.length === 1) {
    // Single firing instance: the rendered title (and optional description),
    // then the instance's detail line.
    const instance = firing[0];
    lines.push("", renderTitle(input.def, instance));
    const description = renderDescription(input.def, instance);
    if (description) lines.push("", description);
    lines.push("", instanceLine(instance, "firing", opts.now, "•"));
  } else if (input.kind === "firing") {
    // Multiple firing instances: repeat the title per instance, each rendered
    // from that instance's own row, with its detail line indented beneath.
    lines.push("");
    for (const instance of firing) {
      pushFiringBlock(lines, input.def, instance, opts.now);
    }
  } else if (input.kind === "resolved") {
    for (const instance of resolved) {
      const duration = instance.firedAt
        ? formatDuration(instance.firedAt, opts.now)
        : "";
      lines.push(
        "",
        duration
          ? `Instance resolved (fired for ${duration})`
          : "Instance resolved",
      );
      lines.push(instanceLine(instance, "resolved", opts.now, "•"));
    }
  } else {
    // Mixed: a firing section (per-instance titles) and a resolved section.
    if (firing.length > 0) {
      lines.push("", "Firing:");
      for (const instance of firing) {
        pushFiringBlock(lines, input.def, instance, opts.now);
      }
    }
    if (resolved.length > 0) {
      lines.push("", "Resolved:");
      for (const instance of resolved) {
        lines.push(instanceLine(instance, "resolved", opts.now, "•"));
      }
    }
  }

  const notebookLine = opts.notebookUrl
    ? `\nNotebook: ${opts.notebookUrl}`
    : "";
  const footer = `\n\n${formatUtc(opts.now)}\nAlert: ${opts.url}${notebookLine}`;
  return truncate(lines.join("\n"), footer);
}
