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
  if (input.kind === "firing") {
    lines.push("", input.title);
    if (input.description) lines.push(input.description);
  } else {
    const duration = input.instance.firedAt
      ? formatDuration(input.instance.firedAt, opts.now)
      : "";
    lines.push(
      "",
      duration
        ? `Instance resolved (fired for ${duration})`
        : "Instance resolved",
    );
  }
  lines.push("", instanceLine(input.instance, input.kind, opts.now, "•"));
  lines.push("", formatUtc(opts.now), opts.url);
  return lines.join("\n");
}
