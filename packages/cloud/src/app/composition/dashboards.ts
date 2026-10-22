import type { ApplicationDashboards } from "@everr/app/composition";
import { parseBuiltinDashboard } from "@everr/app/data/dashboards/built-in";
import source from "../../data/dashboards/telemetry-usage.yaml?raw";

export const dashboards: ApplicationDashboards = {
  additionalBuiltinDashboards: [parseBuiltinDashboard(source)],
};
