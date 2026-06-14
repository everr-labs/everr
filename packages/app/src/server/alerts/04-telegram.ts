import {
  type BuildOptions,
  type DeliveryInput,
  formatUtc,
  instanceLines,
  KIND_STATUS,
  type NotifiableInstance,
} from "./04-format";

// Plain text by choice: no parse mode means nothing to escape, nothing for
// Telegram to reject, and the URL in the body needs no validation.
export function buildTelegramText(
  input: DeliveryInput,
  listed: readonly NotifiableInstance[],
  opts: BuildOptions,
): string {
  const status = KIND_STATUS[input.kind];
  const lines: string[] = [
    `${status.emoji} ${input.def.slug} ${status.label.toLowerCase()}`,
  ];
  switch (input.kind) {
    case "firing":
      lines.push("", input.title);
      if (input.description) lines.push(input.description);
      lines.push("", `Firing: ${input.firingCount}`);
      break;
    case "partial_resolved":
      lines.push("", `Resolved: ${listed.length}`);
      lines.push(`Still firing: ${input.firingCount}`);
      break;
    case "resolved":
      lines.push("", "All instances resolved");
      break;
  }
  lines.push(...instanceLines(listed, input.kind, opts.now, "•"));
  lines.push("", formatUtc(opts.now), opts.url);
  return lines.join("\n");
}
