import { captureError, errors, interactions, performance, WebSDK } from "@everr/otel-web";

export type TelemetryContext = {
  serviceVersion: string;
  telemetryEnabled: boolean;
  deploymentEnvironment: "development" | "production";
};

// Until the backend supplies its build mode, treat errors as production data.
let developmentTelemetry = false;

export function initializeTelemetry(context: TelemetryContext) {
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
  return JSON.stringify(
    JSON.parse(body),
    (_key, value: { key: string; value?: { stringValue?: string } }): unknown => {
      if (Array.isArray(value)) {
        return value.filter(
          (attribute: { key: string }) =>
            !(typeof attribute?.key === "string" && attribute.key.startsWith("everr.utm.")) &&
            ![
              "everr.element.selector",
              "everr.browser.web_vital.lcp.target",
              "everr.browser.web_vital.cls.largest_shift_target",
            ].includes(attribute?.key),
        );
      }
      if (
        value &&
        typeof value === "object" &&
        ["url.full", "everr.landing.url", "everr.referrer.url", "everr.element.href"].includes(
          value.key,
        ) &&
        typeof value.value?.stringValue === "string"
      ) {
        const url = value.value.stringValue;
        return {
          ...value,
          value: { ...value.value, stringValue: url.split(/[?#]/)[0] },
        };
      }
      return value;
    },
  );
}

export function captureLocalSqlError(error: unknown) {
  captureError(developmentTelemetry ? error : new Error("Local telemetry query failed"), {
    "everr.error.source": "local-ui.local_sql",
  });
}
