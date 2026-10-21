import { captureError, errors, interactions, performance, WebSDK } from "@everr/otel-web";
import { z } from "zod";

const TelemetryContextSchema = z.object({
  serviceVersion: z.string(),
  telemetryEnabled: z.boolean(),
  deploymentEnvironment: z.enum(["development", "production"]),
});

const JsonValueSchema = z.json();
type JsonValue = z.infer<typeof JsonValueSchema>;

const UrlValueSchema = z.object({ stringValue: z.string() }).catchall(JsonValueSchema);
const urlAttributeKeys = new Set([
  "url.full",
  "everr.landing.url",
  "everr.referrer.url",
  "everr.element.href",
]);
const privateAttributeKeys = new Set([
  "everr.element.selector",
  "everr.browser.web_vital.lcp.target",
  "everr.browser.web_vital.cls.largest_shift_target",
]);

// Until the backend supplies its build mode, treat errors as production data.
let developmentTelemetry = false;

export function initializeTelemetry(input: unknown) {
  developmentTelemetry = false;
  const context = TelemetryContextSchema.parse(input);
  developmentTelemetry = context.deploymentEnvironment === "development";
  if (!context.telemetryEnabled) return;

  return new WebSDK({
    serviceName: "everr-local-ui",
    serviceVersion: context.serviceVersion,
    deploymentEnvironment: context.deploymentEnvironment,
    serviceInstanceId: crypto.randomUUID(),
    send: async (signal, body) => {
      const response = await fetch(`/api/telemetry/${signal}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Everr-Local": "1",
        },
        body:
          context.deploymentEnvironment === "production" ? sanitizeReleaseTelemetry(body) : body,
      });
      if (!response.ok) throw new Error("Failed to export internal UI telemetry");
    },
    instrumentations: [errors(), interactions(), performance()],
  });
}

// Explore filters are stored in page and interaction URLs. UTM query values
// are also copied into standalone attribution attributes. DOM selectors can
// contain customer span names in labels, titles, or ids, including selectors
// captured by performance instrumentation. Sanitize every OTLP attribute list
// before release export, including resource attributes and span events.
function sanitizeReleaseTelemetry(body: string): string {
  return JSON.stringify(sanitizeJson(JsonValueSchema.parse(JSON.parse(body))));
}

function isPrivateAttribute(value: JsonValue): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    typeof value.key === "string" &&
    (value.key.startsWith("everr.utm.") || privateAttributeKeys.has(value.key))
  );
}

function sanitizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value))
    return value.filter((item) => !isPrivateAttribute(item)).map(sanitizeJson);
  if (value === null || typeof value !== "object") return value;

  const sanitized = Object.fromEntries(
    Object.entries(value).map(([key, child]): [string, JsonValue] => [key, sanitizeJson(child)]),
  );
  if (typeof sanitized.key !== "string" || !urlAttributeKeys.has(sanitized.key)) return sanitized;

  const urlValue = UrlValueSchema.safeParse(sanitized.value);
  if (!urlValue.success) return sanitized;
  return {
    ...sanitized,
    value: { ...urlValue.data, stringValue: urlValue.data.stringValue.split(/[?#]/)[0] },
  };
}

export function captureLocalSqlError(error: unknown) {
  captureError(developmentTelemetry ? error : new Error("Local telemetry query failed"), {
    "everr.error.source": "local-ui.local_sql",
  });
}
