import {
  collectPanelDeprecations,
  collectPanelsMapWarnings,
  formatDeprecation,
} from "@/data/dashboards/deprecations";
import { extractPanelFences, parsePanelEmbed } from "./embed";
import type { RunbookPage } from "./schema";
import { runbookSpecSchema } from "./schema";

/**
 * Deprecation warnings for a runbook: its `spec.panels` map plus every inline
 * panel embedded in markdown. A fence that doesn't parse is skipped rather
 * than reported — `validateFences` has already failed the apply for it, and a
 * deprecation notice on top would only bury that error.
 */
export function collectRunbookWarnings(
  path: string,
  document: unknown,
): string[] {
  const warnings = collectPanelsMapWarnings(path, document);

  // Non-strict on purpose: a spec that fails strict validation never reaches a
  // successful apply, and one that fails even this parse has no markdown worth
  // walking.
  const parsed = runbookSpecSchema.safeParse(
    (document as { spec?: unknown } | null | undefined)?.spec,
  );
  if (!parsed.success) return warnings;
  const spec = parsed.data;

  const scan = (markdown: string | undefined, where: string) => {
    for (const fence of extractPanelFences(markdown ?? "")) {
      let embed: ReturnType<typeof parsePanelEmbed>;
      try {
        embed = parsePanelEmbed(fence.yaml);
      } catch {
        continue;
      }
      if (embed.kind !== "inline") continue;
      for (const deprecation of collectPanelDeprecations(
        embed.panel.spec.plugin,
      )) {
        warnings.push(formatDeprecation(path, where, deprecation));
      }
    }
  };

  scan(spec.markdown.inline, "index markdown");
  const walk = (pages: RunbookPage[] | undefined, prefix: string) => {
    for (const page of pages ?? []) {
      const pagePath = prefix ? `${prefix}/${page.name}` : page.name;
      scan(page.markdown.inline, `page "${pagePath}"`);
      walk(page.pages, pagePath);
    }
  };
  walk(spec.pages, "");

  return warnings;
}
