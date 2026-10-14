import {
  captureError,
  errors,
  interactions,
  performance,
  WebSDK,
} from "@everr/otel-web";

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
          context.deploymentEnvironment === "production"
            ? stripTelemetryUrlQueries(body)
            : body,
      });
      if (!response.ok)
        throw new Error("Failed to export internal UI telemetry");
    },
    instrumentations: [errors(), interactions(), performance()],
  });
}

// Explore filters are stored in the page URL. Redact both record attributes
// and resource attributes (including the SDK's landing URL) before export.
function stripTelemetryUrlQueries(body: string): string {
  return JSON.stringify(JSON.parse(body), (_key, value) => {
    if (
      value &&
      typeof value === "object" &&
      ["url.full", "everr.landing.url", "everr.referrer.url"].includes(
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
  });
}

export function captureLocalSqlError(error: unknown) {
  captureError(
    developmentTelemetry ? error : new Error("Local telemetry query failed"),
    { "everr.error.source": "local-ui.local_sql" },
  );
}
