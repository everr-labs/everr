import * as z from "zod";

/**
 * Table plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted so `{}` always parses — the lenient render path relies on it.
 */
export const tableSpec = z.looseObject({
  stickyHeader: z.boolean().default(false),
});

export type TableSpec = z.infer<typeof tableSpec>;
