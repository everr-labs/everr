import type {
  ApplicationDashboards,
  BuiltinDashboard,
} from "@everr/app/composition";
import { parse } from "yaml";
import source from "./data/dashboards/telemetry-usage.yaml?raw";

export const dashboards: ApplicationDashboards = {
  additionalBuiltinDashboards: [parse(source) as BuiltinDashboard],
};
