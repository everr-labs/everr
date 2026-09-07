import { fromMarkdown } from "mdast-util-from-markdown";
import { parse } from "yaml";
import * as z from "zod";
import type { Panel } from "@/data/dashboards/schema";
import { panel } from "@/data/dashboards/schema";
import { firstZodIssue } from "@/lib/zod-issue";

/** One ```panel fence, resolved to how it renders. */
export type PanelEmbed =
  | { kind: "inline"; panel: Panel; height: number | undefined }
  | { kind: "ref"; ref: string; height: number | undefined };

const heightSchema = z.number().int().min(80).max(2000).optional();

const refEmbed = z.object({ ref: z.string().min(1), height: heightSchema });

/**
 * Parse the YAML body of a ```panel fence into one of the two embed forms: an
 * inline `kind: Panel` object, or a `ref:` to the runbook's shared panels.
 * Throws with a human-readable message — render and apply paths both surface it.
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

  // `ref:` and an inline `kind: Panel` are distinct embed forms; a block with
  // both is an authoring mistake. Reject it rather than silently taking `ref`
  // (which the ordering below would otherwise do).
  if ("ref" in obj && obj.kind === "Panel") {
    throw new Error(
      'panel block has both "ref" and "kind: Panel"; use exactly one — a "ref:" to a shared panel or an inline "kind: Panel"',
    );
  }

  if ("ref" in obj) {
    const r = refEmbed.safeParse(obj);
    if (!r.success) throw new Error(firstZodIssue(r.error));
    return { kind: "ref", ref: r.data.ref, height: r.data.height };
  }

  if (obj.kind === "Panel") {
    const { height: rawHeight, ...rest } = obj;
    const h = heightSchema.safeParse(rawHeight);
    if (!h.success)
      throw new Error(`invalid height: ${firstZodIssue(h.error)}`);
    const p = panel.safeParse(rest);
    if (!p.success)
      throw new Error(`invalid inline panel: ${firstZodIssue(p.error)}`);
    return { kind: "inline", panel: p.data, height: h.data };
  }

  throw new Error(
    'panel block must be an inline panel (kind: Panel) or a "ref:" to a runbook panel',
  );
}

export interface PanelFence {
  /** The YAML body between the fence markers. */
  yaml: string;
}

/**
 * The slice of an mdast node we walk: a `code` leaf carries the fence's info
 * string (`lang`) and body (`value`); container nodes carry `children`.
 */
interface MdastNode {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MdastNode[];
}

/**
 * Extract the bodies of ```panel fences for apply-time validation. Parses with
 * the SAME CommonMark engine the viewer renders through (react-markdown →
 * remark-parse → mdast-util-from-markdown), so apply sees exactly the fences the
 * renderer will turn into panels: indented fences, `~~~` fences, fences nested
 * in blockquotes/lists, and a `panel` info string with trailing meta all count —
 * none of which a column-0 regex would catch, letting an invalid block slip past
 * validation and only fail at render time.
 *
 * The renderer keys off the code node's first info word (`language-panel`), so
 * we match `lang === "panel"` to stay in lockstep with it.
 */
export function extractPanelFences(markdown: string): PanelFence[] {
  const fences: PanelFence[] = [];
  const visit = (node: MdastNode) => {
    if (node.type === "code") {
      if (node.lang === "panel")
        fences.push({ yaml: (node.value ?? "").trim() });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(markdown) as MdastNode);
  return fences;
}
