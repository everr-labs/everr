import type { BuiltinDashboard } from "@everr/app/data/dashboards/built-in/types";
import type { ApplicationDashboards } from "@everr/app/product/dashboards";
import { parse } from "yaml";
import source from "./data/dashboards/telemetry-usage.yaml?raw";

export const dashboards: ApplicationDashboards = {
  additionalBuiltinDashboards: [parse(source) as BuiltinDashboard],
};
