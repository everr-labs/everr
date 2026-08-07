import * as z from "zod";
import { dashboardProjectSchema } from "@/data/dashboards/schema";
import { isReservedAnnotationKey } from "../resource-annotations";

export const alertingNonEmptyStringSchema = z.string().min(1);

export const alertingResourceSlugSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_.-]{1,128}$/,
    "name must be 1-128 chars of [A-Za-z0-9_.-]",
  );

export const alertingResourceNameSchema = z
  .string()
  .superRefine((value, ctx) => {
    const parts = value.split("/");
    if (
      parts.length !== 2 ||
      !dashboardProjectSchema.safeParse(parts[0]).success ||
      !alertingResourceSlugSchema.safeParse(parts[1]).success
    ) {
      ctx.addIssue({
        code: "custom",
        message: 'name must be "project/slug"',
      });
    }
  });

export const alertingResourceLabelsSchema = z.record(
  alertingNonEmptyStringSchema,
  alertingNonEmptyStringSchema,
);

export const alertingResourceMetadataSchema = z
  .object({
    name: alertingResourceSlugSchema,
    project: dashboardProjectSchema.optional(),
    labels: alertingResourceLabelsSchema.optional(),
  })
  .strict();

export const alertingDisplaySchema = z
  .object({
    name: alertingNonEmptyStringSchema.optional(),
    description: alertingNonEmptyStringSchema.optional(),
  })
  .strict();

export function alertingChannelNamesSchema(minimum = 0) {
  return z
    .array(alertingNonEmptyStringSchema)
    .min(minimum)
    .refine((channels) => new Set(channels).size === channels.length, {
      message: "notification channels must be unique",
    });
}

export const alertingResourceAnnotationsSchema = z
  .record(alertingNonEmptyStringSchema, z.string())
  .superRefine((annotations, ctx) => {
    for (const key of Object.keys(annotations)) {
      if (isReservedAnnotationKey(key)) {
        ctx.addIssue({
          code: "custom",
          message: `spec.annotations key "${key}" is reserved`,
          path: [key],
        });
      }
    }
  });
