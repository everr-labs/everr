import { z } from "zod";

// JSONEachRow may quote integer columns. Preserve their representation until
// existing presentation mappers convert counts; never coerce IDs or nanoseconds.
export const SqlCountSchema = z
  .union([z.number().nonnegative().refine(Number.isInteger), z.string().regex(/^\d+$/)])
  .refine((value) => Number.isFinite(Number(value)), "Expected a finite count");

export const SqlUnsignedIntegerTextSchema = z.string().regex(/^\d+$/);
export const SqlIntegerTextSchema = z.string().regex(/^-?\d+$/);

const IsoTimestampSchema = z.iso.datetime({ offset: true });
export const SqlTimestampSchema = z.string().refine((value) => {
  const iso = value
    .trim()
    .replace(/[ t]/i, "T")
    .replace(/z$/i, "Z")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`;
  return IsoTimestampSchema.safeParse(zoned).success;
}, "Expected a SQL timestamp");

// JSON attributes remain dynamic. Null or absent maps retain the existing
// empty-map behavior in flattenAttributes, and nested values stay untouched.
export const SqlAttributesSchema = z.record(z.string(), z.json()).nullish();
