import * as z from "zod";
import { valueFormatSpec } from "../value-format-spec";

/**
 * Table plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted so `{}` always parses — the lenient render path relies on it.
 */
export const tableSpec = z.looseObject({
  valueFormat: valueFormatSpec.optional(),
  columns: z
    .record(
      z.string(),
      z.looseObject({ valueFormat: valueFormatSpec.optional() }),
    )
    .default({}),
  stickyHeader: z.boolean().default(false),
});

export type TableSpec = z.infer<typeof tableSpec>;
