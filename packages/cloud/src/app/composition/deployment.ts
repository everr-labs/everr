import type { ApplicationDeployment } from "@everr/app/composition";

export const deployment: ApplicationDeployment = {
  ingestEndpoint: import.meta.env.DEV ? "http://localhost:4318" : "https://ingest.everr.dev/",
};
