import * as z from "zod";
import {
  dashboardProjectSchema,
  dashboardSlugSchema,
} from "@/data/dashboards/schema";

function runbookRefParts(
  raw: string,
): { project?: string; slug: string } | null {
  const parts = raw.split("/");
  if (parts.length > 2) return null;
  return parts.length === 2
    ? { project: parts[0], slug: parts[1] }
    : { slug: parts[0] };
}

export const runbookRefSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    const ref = runbookRefParts(value);
    if (!ref) {
      ctx.addIssue({
        code: "custom",
        message: 'runbook ref must be "slug" or "project/slug"',
      });
      return;
    }
    if (!dashboardSlugSchema.safeParse(ref.slug).success) {
      ctx.addIssue({
        code: "custom",
        message: `invalid runbook slug "${ref.slug}"`,
      });
    }
    if (
      ref.project !== undefined &&
      !dashboardProjectSchema.safeParse(ref.project).success
    ) {
      ctx.addIssue({
        code: "custom",
        message: `invalid runbook project "${ref.project}"`,
      });
    }
  });

export function parseRunbookRef(
  raw: string,
  alertProject: string,
): { project: string; slug: string } {
  const ref = runbookRefParts(raw) ?? { slug: raw };
  return { project: ref.project ?? alertProject, slug: ref.slug };
}

// NUL separates the two values and prevents identity collisions.
export function refIdentityKey(project: string, slug: string): string {
  return `${project}\0${slug}`;
}

export function formatRunbookRef(project: string, slug: string): string {
  return project === "default" ? slug : `${project}/${slug}`;
}
