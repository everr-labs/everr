import {
  type BuildOptions,
  type DeliveryInput,
  formatDuration,
  formatUtc,
  instanceLine,
  KIND_STATUS,
} from "./04-format";

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

  if (input.kind === "mixed") {
    // Mixed: firing + resolved in one notification
    const firingInstances = input.instances.filter((i) => i.row);
    const resolvedInstances = input.instances.filter((i) => !i.row);

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
    lines.push("", input.title);
    if (input.instances.length === 1 && input.description) {
      lines.push("", input.description);
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
