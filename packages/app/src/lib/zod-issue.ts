import type { z } from "zod";

/**
 * The first rejection a schema reported, with the field it came from.
 *
 * A zod error carries every issue; a message a person reads wants one. The
 * first is the one the parse stopped on, so it is the one to fix next.
 */
export function firstZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const where =
    issue && issue.path.length > 0
      ? ` at ${issue.path.map(String).join(".")}`
      : "";
  return `${issue?.message}${where}`;
}
