import { renderMessage } from "@/data/alerts/template";
import {
  type BuildOptions,
  type DeliveryInput,
  formatDuration,
  formatUtc,
  instanceDetailText,
  instanceLine,
  KIND_STATUS,
  type NotifiableInstance,
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

  lines.push("", formatUtc(opts.now), opts.url);
  return lines.join("\n");
}

// Two lines per firing instance: the title (rendered from this instance's row)
// and its labels + breaching values indented beneath.
function pushFiringBlock(
  lines: string[],
  def: DeliveryInput["def"],
  instance: NotifiableInstance,
  now: Date,
): void {
  lines.push(`• ${renderTitle(def, instance)}`);
  lines.push(`  ${instanceDetailText(instance, "firing", now)}`);
}

function renderTitle(
  def: DeliveryInput["def"],
  instance: NotifiableInstance,
): string {
  return renderMessage(def.notificationTitleTemplate, {
    firstRow: instance.row,
  });
}

function renderDescription(
  def: DeliveryInput["def"],
  instance: NotifiableInstance,
): string {
  return def.notificationDescriptionTemplate
    ? renderMessage(def.notificationDescriptionTemplate, {
        firstRow: instance.row,
      })
    : "";
}
