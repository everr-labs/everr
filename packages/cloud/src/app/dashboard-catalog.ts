import { parse } from "yaml";
import type { BuiltinDashboard } from "@everr/app/data/dashboards/built-in/types";
import source from "../data/dashboards/telemetry-usage.yaml?raw";

export const additionalBuiltinDashboards: BuiltinDashboard[] = [
  parse(source) as BuiltinDashboard,
];
