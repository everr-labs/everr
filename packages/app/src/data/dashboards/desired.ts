import { ApplyValidationError } from "@/data/as-code/errors";
import type { DesiredDashboard } from "./reconcile";
import {
  dashboardProjectSchema,
  dashboardSlugSchema,
  dashboardSpecSchema,
} from "./schema";

export interface InputDocument {
  /** POSIX-style path relative to the applied root, e.g. "team/cpu.yaml". */
  path: string;
  /** Raw parsed YAML/JSON document. */
  document: unknown;
}

/** Normalize a single path segment: "latency_p99" -> "latency p99". */
function segmentLabel(segment: string): string {
  return segment.replace(/[_-]+/g, " ").trim();
}

/** Folder path from a file path: directory segments joined by " / ". */
function folderPathFromFile(path: string): string {
  const segments = path
    .split("/")
    .slice(0, -1)
    .filter((s) => s !== ".")
    .map(segmentLabel)
    .filter(Boolean);
  return segments.join(" / ");
}

const DEFAULT_PROJECT = "default";

/** Project from metadata.project, defaulting to "default"; validated. */
function projectFromDocument(path: string, document: unknown): string {
  const meta = (document as { metadata?: { project?: unknown } }).metadata;
  const raw =
    meta && typeof meta.project === "string" && meta.project.length > 0
      ? meta.project
      : DEFAULT_PROJECT;
  const result = dashboardProjectSchema.safeParse(raw);
  if (!result.success) {
    throw new ApplyValidationError(
      `${path}: invalid project "${raw}": ${result.error.issues[0]?.message}`,
    );
  }
  return raw;
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
 * the same project.
 */
export function buildDesiredSet(inputs: InputDocument[]): DesiredDashboard[] {
  const out: DesiredDashboard[] = [];
  const seen = new Map<string, string>(); // `${project} ${slug}` -> first path

  for (const { path, document } of inputs) {
    const project = projectFromDocument(path, document);
    const slug = slugFromDocument(path, document);

    const slugResult = dashboardSlugSchema.safeParse(slug);
    if (!slugResult.success) {
      throw new ApplyValidationError(
        `${path}: invalid dashboard name "${slug}": ${slugResult.error.issues[0]?.message}`,
      );
    }

    const rawSpec = (document as { spec?: unknown }).spec;
    const specResult = dashboardSpecSchema.safeParse(rawSpec);
    if (!specResult.success) {
      throw new ApplyValidationError(
        `${path}: invalid dashboard spec: ${specResult.error.issues[0]?.message}`,
      );
    }

    const key = `${project} ${slug}`;
    const prior = seen.get(key);
    if (prior) {
      throw new ApplyValidationError(
        `duplicate dashboard "${slug}" in project "${project}" (${prior} and ${path})`,
      );
    }
    seen.set(key, path);

    // Store the whole parsed document, not just the parsed spec, so unknown
    // Perses fields (including top-level keys) survive verbatim — the file is
    // the source of truth.
    out.push({
      project,
      slug,
      folderPath: folderPathFromFile(path),
      document: document as DesiredDashboard["document"],
    });
  }

  return out;
}
