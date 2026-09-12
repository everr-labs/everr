import * as z from "zod";

export const durationUnits: Readonly<Record<string, number>> = {
  ns: 1e-9,
  us: 1e-6,
  ms: 1e-3,
  s: 1,
  min: 60,
  h: 3600,
  d: 86400,
};

export const valueFormatSpec = z
  .looseObject({
    unit: z.string().default(""),
    scale: z.enum(["none", "decimal", "binary", "duration"]).default("none"),
    decimals: z.number().int().min(0).max(10).optional(),
    display: z.enum(["value", "percent"]).optional(),
  })
  .refine(
    (format) =>
      format.scale !== "duration" || Object.hasOwn(durationUnits, format.unit),
    {
      path: ["unit"],
      message: "Duration scaling requires ns, us, ms, s, min, h, or d",
    },
  )
  .refine((format) => format.display !== "percent" || format.unit === "1", {
    path: ["display"],
    message: "Percent display requires the dimensionless unit 1",
  })
  .refine((format) => format.display !== "percent" || format.scale === "none", {
    path: ["scale"],
    message: "Percent display requires scale none",
  });

export type ValueFormat = z.infer<typeof valueFormatSpec>;
