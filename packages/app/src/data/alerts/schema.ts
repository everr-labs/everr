import { load } from "js-yaml";
import { z } from "zod";

const slugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/, "must be a slug");

const durationSchema = z
  .string()
  .regex(/^[1-9][0-9]*(s|m|h|d)$/, "must be a duration such as 1m");

const alertVariableNames = new Set([
  "window",
  "row_count",
  "top_route",
  "top_error_count",
]);

const alertWindowVariable = `\${window}`;

function durationSeconds(value: string): number {
  const amount = Number.parseInt(value.slice(0, -1), 10);
  const unit = value.at(-1);

  if (unit === "s") return amount;
  if (unit === "m") return amount * 60;
  if (unit === "h") return amount * 60 * 60;
  if (unit === "d") return amount * 24 * 60 * 60;

  return Number.NaN;
}

function clickHouseIntervalFragment(value: string): string {
  const amount = Number.parseInt(value.slice(0, -1), 10);
  const unit = value.at(-1);

  if (unit === "s") return `${amount} SECOND`;
  if (unit === "m") return `${amount} MINUTE`;
  if (unit === "h") return `${amount} HOUR`;
  if (unit === "d") return `${amount} DAY`;

  throw new Error(`Unsupported alert window duration "${value}".`);
}

function assertSupportedVariables(value: string, path: string) {
  for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    const name = match[1];
    if (!name || !alertVariableNames.has(name)) {
      throw new Error(`Unsupported alert variable "\${${name}}" in ${path}.`);
    }
  }
}

const alertRuleSchema = z.object({
  kind: z.literal("AlertRule"),
  metadata: z.object({
    name: slugSchema,
    project: slugSchema.default("default"),
    previousName: slugSchema.optional(),
    labels: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.object({
    severity: z.enum(["critical", "warning"]),
    evaluationInterval: durationSchema.refine(
      (value) => durationSeconds(value) >= 60,
      "evaluationInterval must be at least 1m",
    ),
    window: durationSchema,
    summary: z.string().min(1),
    description: z.string().optional(),
    query: z.string().min(1),
  }),
});

const alertSettingsSchema = z.object({
  kind: z.literal("AlertSettings"),
  spec: z.object({
    notificationDelivery: z.object({
      email: z.object({
        enabled: z.boolean(),
        to: z.array(z.string().email()),
      }),
      telegram: z.object({
        enabled: z.boolean(),
        chatIds: z.array(z.string().min(1)),
      }),
    }),
  }),
});

const alertResourceSchema = z.discriminatedUnion("kind", [
  alertRuleSchema,
  alertSettingsSchema,
]);

export type AlertResource = z.infer<typeof alertResourceSchema>;
export type AlertRuleResource = z.infer<typeof alertRuleSchema>;

export type RawAlertResourceFile = {
  path: string;
  content: string;
};

export type ParsedAlertResource<T extends AlertResource = AlertResource> = {
  path: string;
  resource: T;
};

function isAlertRuleResource(
  item: ParsedAlertResource,
): item is ParsedAlertResource<AlertRuleResource> {
  return item.resource.kind === "AlertRule";
}

export function parseAlertResourceFile(
  file: RawAlertResourceFile,
): ParsedAlertResource {
  const loaded = load(file.content);
  const resource = alertResourceSchema.parse(loaded);

  if (resource.kind === "AlertRule") {
    assertSupportedVariables(resource.spec.summary, `${file.path}:summary`);
    if (resource.spec.description) {
      assertSupportedVariables(
        resource.spec.description,
        `${file.path}:description`,
      );
    }
    assertSupportedVariables(resource.spec.query, `${file.path}:query`);
  }

  return { path: file.path, resource };
}

export function renderAlertRuleQuery(rule: AlertRuleResource): string {
  return rule.spec.query.replaceAll(
    alertWindowVariable,
    clickHouseIntervalFragment(rule.spec.window),
  );
}

export function parseAlertResourceFiles(files: RawAlertResourceFile[]) {
  const parsed = files.map(parseAlertResourceFile);
  const rules: ParsedAlertResource<AlertRuleResource>[] = [];
  let settings: ParsedAlertResource | undefined;
  const seen = new Map<string, string>();

  for (const item of parsed) {
    if (isAlertRuleResource(item)) {
      const key = `${item.resource.metadata.project}/${item.resource.metadata.name}`;
      const existing = seen.get(key);
      if (existing) {
        throw new Error(
          `Duplicate AlertRule metadata.name "${item.resource.metadata.name}" in project "${item.resource.metadata.project}" (${existing} and ${item.path}).`,
        );
      }
      seen.set(key, item.path);
      rules.push(item);
    } else {
      if (settings) {
        throw new Error(
          `Only one AlertSettings resource is allowed (${settings.path} and ${item.path}).`,
        );
      }
      settings = item;
    }
  }

  return { rules, settings };
}
