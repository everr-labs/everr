import { appEnv } from "./env";

export function getIngestEndpoint() {
  return appEnv.EVERR_PUBLIC_INGEST_URL;
}
