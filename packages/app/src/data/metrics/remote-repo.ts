import type { MetricsRepositoryLike } from "@everr/telemetry-explorer/metrics";
import {
  getMetricAttributeKeys,
  getMetricAttributeValues,
  getMetricCatalog,
  getMetricEnvironments,
  getMetricExemplars,
  getMetricExportInterval,
  getMetricKinds,
  getMetricMetadata,
  getMetricNames,
  getMetricSeries,
  getMetricServices,
  getMetricSummaryQuantiles,
} from "./server";

export const remoteMetricsRepo: MetricsRepositoryLike = {
  catalog: (input) => getMetricCatalog({ data: input }),
  names: (input) => getMetricNames({ data: input }),
  kinds: (input) => getMetricKinds({ data: input }),
  metadata: (input) => getMetricMetadata({ data: input }),
  series: (input) => getMetricSeries({ data: input }),
  exemplars: (input) => getMetricExemplars({ data: input }),
  attributeKeys: (input) => getMetricAttributeKeys({ data: input }),
  attributeValues: (input) => getMetricAttributeValues({ data: input }),
  services: (input) => getMetricServices({ data: input }),
  environments: (input) => getMetricEnvironments({ data: input }),
  summaryQuantiles: (input) => getMetricSummaryQuantiles({ data: input }),
  exportInterval: (input) => getMetricExportInterval({ data: input }),
};
