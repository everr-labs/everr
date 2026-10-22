import type { ApplicationDeployment } from "#app/composition/deployment.ts";
import { appEnv } from "../env";

export const deployment: ApplicationDeployment = {
  ingestEndpoint: appEnv.EVERR_PUBLIC_INGEST_URL,
};
