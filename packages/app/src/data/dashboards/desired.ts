import type { DesiredDashboard } from "./reconcile";
import { dashboardSlugSchema, dashboardSpecSchema } from "./schema";

export interface InputDocument {
  /** POSIX-style path relative to the applied root, e.g. "team/cpu.yaml". */
  path: string;
  /** Raw parsed YAML/JSON document. */
  document: unknown;
}

/** Titleize a single path segment: "latency_p99" -> "latency p99". */
function segmentLabel(segment: string): string {
  return segment.replace(/[_-]+/g, " ").trim();
}

/** Folder path from a file path: directory segments joined by " / ". */
function folderPathFromFile(path: string): string {
  const segments = path
    .split("/")
    .slice(0, -1)
    .map(segmentLabel)
    .filter(Boolean);
  return segments.join(" / ");
}

/** Slug from metadata.name, falling back to the filename without extension. */
function slugFromDocument(path: string, document: unknown): string {
  const meta = (document as { metadata?: { name?: unknown } }).metadata;
  if (meta && typeof meta.name === "string" && meta.name.length > 0) {
    return meta.name;
  }
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.(ya?ml|json)$/i, "");
}

/**
 * Validate and normalize parsed documents into a desired set for `reconcile`.
 * Throws on schema failure (message names the file) or a duplicate slug within
 * the source.
 */
export function buildDesiredSet(inputs: InputDocument[]): DesiredDashboard[] {
  const out: DesiredDashboard[] = [];
  const seen = new Map<string, string>(); // slug -> first path

  for (const { path, document } of inputs) {
    const slug = slugFromDocument(path, document);

    const slugResult = dashboardSlugSchema.safeParse(slug);
    if (!slugResult.success) {
      throw new Error(
        `${path}: invalid dashboard name "${slug}": ${slugResult.error.issues[0]?.message}`,
      );
    }

    const rawSpec = (document as { spec?: unknown }).spec;
    const specResult = dashboardSpecSchema.safeParse(rawSpec);
    if (!specResult.success) {
      throw new Error(
        `${path}: invalid dashboard spec: ${specResult.error.issues[0]?.message}`,
      );
    }

    const prior = seen.get(slug);
    if (prior) {
      throw new Error(
        `duplicate dashboard "${slug}" in source (${prior} and ${path})`,
      );
    }
    seen.set(slug, path);

    // Store the raw spec, not the parsed result, so unknown Perses fields
    // survive verbatim (the file is the source of truth).
    out.push({
      slug,
      folderPath: folderPathFromFile(path),
      spec: rawSpec as DesiredDashboard["spec"],
    });
  }

  return out;
}
