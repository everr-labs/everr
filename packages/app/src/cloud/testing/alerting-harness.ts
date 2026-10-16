import {
  createAlertingHarness as createHarness,
  useAlertingHarness as useHarness,
} from "@/server/alerting/testing/harness";
import { cloudTestMigrations } from "./migrations";

export type { AlertingHarness } from "@/server/alerting/testing/harness";

export function createAlertingHarness() {
  return createHarness(cloudTestMigrations);
}

export function useAlertingHarness() {
  return useHarness(cloudTestMigrations);
}
