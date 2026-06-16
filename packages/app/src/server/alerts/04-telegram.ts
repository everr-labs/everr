import {
  type BuildOptions,
  type DeliveryInput,
  formatDuration,
  formatUtc,
  instanceLine,
  KIND_STATUS,
  type NotifiableInstance,
} from "./04-format";

export interface RenderedMessages {
  title: string;
  description: string;
}

// Plain text by choice: no parse mode means nothing to escape, nothing for
// Telegram to reject, and the URL in the body needs no validation.
export function buildTelegramText(
  input: DeliveryInput,
  rendered: RenderedMessages,
  opts: BuildOptions,
): string {
  const status = KIND_STATUS[input.kind];
  const lines: string[] = [
    `${status.emoji} ${input.def.slug} ${status.label.toLowerCase()}`,
  ];

  if (input.kind === "mixed") {
    // Mixed: firing + resolved in one notification. Split by the instance's own
    // kind in a single pass rather than inferring it from `row` presence.
    const firingInstances: NotifiableInstance[] = [];
    const resolvedInstances: NotifiableInstance[] = [];
    for (const instance of input.instances) {
      (instance.kind === "resolved" ? resolvedInstances : firingInstances).push(
        instance,
      );
    }

    if (firingInstances.length > 0) {
      lines.push("", "Firing:");
      for (const instance of firingInstances) {
        lines.push(instanceLine(instance, "firing", opts.now, "•"));
      }
    }
    if (resolvedInstances.length > 0) {
      lines.push("", "Resolved:");
      for (const instance of resolvedInstances) {
        lines.push(instanceLine(instance, "resolved", opts.now, "•"));
      }
    }
  } else if (input.kind === "firing") {
    lines.push("", rendered.title);
    if (rendered.description) {
      lines.push("", rendered.description);
    }
    lines.push("");
    for (const instance of input.instances) {
      lines.push(instanceLine(instance, "firing", opts.now, "•"));
    }
  } else {
    // resolved
    for (const instance of input.instances) {
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
  }

  lines.push("", formatUtc(opts.now), opts.url);
  return lines.join("\n");
}
