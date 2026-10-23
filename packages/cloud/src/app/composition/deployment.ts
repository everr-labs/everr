import type { ApplicationDeployment } from "@everr/app/composition";

export const deployment: ApplicationDeployment = {
  ingestEndpoint: import.meta.env.DEV
    ? (import.meta.env.VITE_EVERR_PUBLIC_INGEST_URL ?? "http://localhost:4318")
    : "https://ingest.everr.dev/",
};
