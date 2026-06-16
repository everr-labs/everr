import * as z from "zod";

const nonEmptyString = z.string().min(1);

const alertLabelsSchema = z.record(nonEmptyString, nonEmptyString);
const alertDisplaySchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

const notificationMessageSchema = z
  .object({
    title: nonEmptyString,
    description: z.string().optional(),
  })
  .strict();

export const EverrConfigYamlSchema = z
  .object({
    repoid: nonEmptyString,
  })
  .strict();

export const AlertRuleYamlSchema = z
  .object({
    kind: z.literal("AlertRule"),
    metadata: z
      .object({
        name: nonEmptyString,
        labels: alertLabelsSchema.optional(),
      })
      .strict(),
    spec: z
      .object({
        display: alertDisplaySchema.optional(),
        evaluationInterval: nonEmptyString,
        notificationMessage: notificationMessageSchema,
        query: nonEmptyString,
        instanceLabels: z.array(nonEmptyString).min(1).optional(),
      })
      .strict(),
  })
  .strict();

export type AlertRuleYaml = z.infer<typeof AlertRuleYamlSchema>;
