import { parse } from "yaml";
import * as z from "zod";
import type { Panel } from "@/data/dashboards/schema";
import {
  dashboardProjectSchema,
  dashboardSlugSchema,
  panel,
} from "@/data/dashboards/schema";

/** One ```panel fence, resolved to how it renders. */
export type PanelEmbed =
  | { kind: "inline"; panel: Panel; height: number | undefined }
  | { kind: "ref"; ref: string; height: number | undefined }
  | {
      kind: "dashboard";
      project: string;
      slug: string;
      panel: string;
      height: number | undefined;
    };

const heightSchema = z.number().int().min(80).max(2000).optional();

const refEmbed = z.object({ ref: z.string().min(1), height: heightSchema });

const dashboardEmbed = z.object({
  dashboard: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/, 'dashboard must be "project/slug"'),
  panel: z.string().min(1),
  height: heightSchema,
});

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const where =
    issue && issue.path.length > 0
      ? ` at ${issue.path.map(String).join(".")}`
      : "";
  return `${issue?.message}${where}`;
}

/**
 * Parse the YAML body of a ```panel fence into one of the three embed forms:
 * an inline `kind: Panel` object, a `ref:` to the notebook's shared panels, or
 * a `dashboard:`+`panel:` reference to a dashboard's panel. Throws with a
 * human-readable message — render and apply paths both surface it.
 */
export function parsePanelEmbed(source: string): PanelEmbed {
  let doc: unknown;
  try {
    doc = parse(source);
  } catch (e) {
    throw new Error(
      `invalid YAML: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("panel block must be a YAML mapping");
  }
  const obj = doc as Record<string, unknown>;

  if ("ref" in obj) {
    const r = refEmbed.safeParse(obj);
    if (!r.success) throw new Error(firstIssue(r.error));
    return { kind: "ref", ref: r.data.ref, height: r.data.height };
  }

  if ("dashboard" in obj) {
    const r = dashboardEmbed.safeParse(obj);
    if (!r.success) throw new Error(firstIssue(r.error));
    const [project, slug] = r.data.dashboard.split("/") as [string, string];
    const projectOk = dashboardProjectSchema.safeParse(project);
    const slugOk = dashboardSlugSchema.safeParse(slug);
    if (!projectOk.success || !slugOk.success) {
      throw new Error(
        'dashboard must be "project/slug" (lowercase letters, digits, hyphens)',
      );
    }
    return {
      kind: "dashboard",
      project,
      slug,
      panel: r.data.panel,
      height: r.data.height,
    };
  }

  if (obj.kind === "Panel") {
    const { height: rawHeight, ...rest } = obj;
    const h = heightSchema.safeParse(rawHeight);
    if (!h.success) throw new Error(`invalid height: ${firstIssue(h.error)}`);
    const p = panel.safeParse(rest);
    if (!p.success)
      throw new Error(`invalid inline panel: ${firstIssue(p.error)}`);
    return { kind: "inline", panel: p.data, height: h.data };
  }

  throw new Error(
    'panel block must be an inline panel (kind: Panel), a "ref:" to a notebook panel, or a "dashboard:" embed',
  );
}

export interface PanelFence {
  /** The YAML body between the fence markers. */
  yaml: string;
}

const FENCE_RE = /^```panel[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;

/**
 * Extract ```panel fences for apply-time validation. The viewer does NOT use
 * this — react-markdown's parser drives rendering — so this only needs to
 * match well-formed fences, not every CommonMark edge case.
 */
export function extractPanelFences(markdown: string): PanelFence[] {
  const fences: PanelFence[] = [];
  for (const match of markdown.matchAll(FENCE_RE)) {
    fences.push({ yaml: (match[1] ?? "").trim() });
  }
  return fences;
}
