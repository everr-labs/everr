import * as z from "zod";

const nonEmptyString = z.string().min(1);

const alertLabelsSchema = z.record(nonEmptyString, nonEmptyString);

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
        evaluationInterval: nonEmptyString,
        window: nonEmptyString,
        summary: nonEmptyString,
        description: z.string().optional(),
        query: nonEmptyString,
      })
      .strict(),
  })
  .strict();

export type AlertRuleYaml = z.infer<typeof AlertRuleYamlSchema>;
