import { errors, interactions, performance, WebSDK } from "@everr/otel-web";
import { invokeCommand } from "./local-api";

if (typeof window !== "undefined") {
  void invokeCommand<{ serviceVersion: string }>("get_telemetry_context")
    .then(({ serviceVersion }) => {
      new WebSDK({
        serviceName: "everr-local-ui",
        serviceVersion,
        deploymentEnvironment: "development",
        serviceInstanceId: crypto.randomUUID(),
        send: async (signal, body) => {
          const response = await fetch(`/api/telemetry/${signal}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Everr-Local": "1",
            },
            body,
          });
          if (!response.ok)
            throw new Error("Failed to export local UI telemetry");
        },
        instrumentations: [errors(), interactions(), performance()],
      });
    })
    .catch(() => {});
}
