import { ApplyValidationError } from "@/data/as-code/errors";
import type { DesiredResource } from "@/data/as-code/reconcile";
/** Shared with the dashboard apply path — same parsed-document shape. */
import type { InputDocument } from "@/data/dashboards/desired";
import {
  folderPathFromFile,
  projectFromDocument,
  slugFromDocument,
} from "@/data/dashboards/desired";
import {
  collectPanelStrictIssues,
  dashboardSlugSchema,
} from "@/data/dashboards/schema";
import type { PanelEmbed } from "./embed";
import { extractPanelFences, parsePanelEmbed } from "./embed";
import type { RunbookPage, RunbookSpec } from "./schema";
import { runbookSpecSchemaStrict } from "./schema";

export type { InputDocument };

/**
 * Validate every ```panel fence in the runbook's markdown (index page and all
 * nested pages): the YAML must parse into one of the two embed forms, `ref:`
 * targets must exist in spec.panels, and inline panels must pass the strict
 * plugin validation — same fail-early contract as dashboard panels.
 */
function validateFences(path: string, spec: RunbookSpec): void {
  const check = (markdown: string | undefined, where: string) => {
    for (const fence of extractPanelFences(markdown ?? "")) {
      let embed: PanelEmbed;
      try {
        embed = parsePanelEmbed(fence.yaml);
      } catch (e) {
        throw new ApplyValidationError(
          `${path}: invalid panel block in ${where}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (
        embed.kind === "ref" &&
        !Object.hasOwn(spec.panels ?? {}, embed.ref)
      ) {
        throw new ApplyValidationError(
          `${path}: panel block in ${where} references unknown panel "${embed.ref}" (not in spec.panels)`,
        );
      }
      if (embed.kind === "inline") {
        const issues = collectPanelStrictIssues(embed.panel);
        if (issues.length > 0) {
          // Report every issue, not just the first, so the author fixes them all
          // in one pass instead of one re-apply per option.
          const detail = issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          throw new ApplyValidationError(
            `${path}: invalid inline panel in ${where}: ${detail}`,
          );
        }
      }
    }
  };

  check(spec.markdown.inline, "index markdown");
  const walk = (pages: RunbookPage[] | undefined, prefix: string) => {
    for (const page of pages ?? []) {
      const pagePath = prefix ? `${prefix}/${page.name}` : page.name;
      check(page.markdown.inline, `page "${pagePath}" markdown`);
      walk(page.pages, pagePath);
    }
  };
  walk(spec.pages, "");
}

/**
 * Validate and normalize parsed Runbook documents into a desired set for
 * `reconcile`. Mirrors the dashboard builder: throws ApplyValidationError
 * naming the file on any failure.
 */
export function buildDesiredRunbookSet(
  inputs: InputDocument[],
): DesiredResource[] {
  const out: DesiredResource[] = [];
  const seen = new Map<string, string>(); // `${project} ${slug}` -> first path

  for (const { path, document } of inputs) {
    const project = projectFromDocument(path, document);
    const slug = slugFromDocument(path, document);

    const slugResult = dashboardSlugSchema.safeParse(slug);
    if (!slugResult.success) {
      throw new ApplyValidationError(
        `${path}: invalid runbook name "${slug}": ${slugResult.error.issues[0]?.message}`,
      );
    }

    const rawSpec = (document as { spec?: unknown }).spec;
    const specResult = runbookSpecSchemaStrict.safeParse(rawSpec);
    if (!specResult.success) {
      const issue = specResult.error.issues[0];
      const where =
        issue && issue.path.length > 0
          ? ` at ${issue.path.map(String).join(".")}`
          : "";
      throw new ApplyValidationError(
        `${path}: invalid runbook spec${where}: ${issue?.message}`,
      );
    }

    validateFences(path, specResult.data);

    const key = `${project} ${slug}`;
    const prior = seen.get(key);
    if (prior) {
      throw new ApplyValidationError(
        `duplicate runbook "${slug}" in project "${project}" (${prior} and ${path})`,
      );
    }
    seen.set(key, path);

    // Store the whole parsed document verbatim, mirroring dashboards.
    out.push({
      project,
      slug,
      folderPath: folderPathFromFile(path),
      document,
    });
  }

  return out;
}
