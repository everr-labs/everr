import type { RuntimeMetricsRepositoryLike } from "@everr/telemetry-explorer/profiles";
import { getProfileRuntimeMetrics } from "./server";

export const remoteRuntimeMetricsRepo: RuntimeMetricsRepositoryLike = {
  runtime: (input) => getProfileRuntimeMetrics({ data: input }),
};
