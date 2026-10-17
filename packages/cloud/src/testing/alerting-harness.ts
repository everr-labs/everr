import {
  createAlertingHarness as createHarness,
  useAlertingHarness as useHarness,
} from "./harness";
import { cloudTestMigrations } from "./migrations";

export type { AlertingHarness } from "./harness";

export function createAlertingHarness() {
  return createHarness(cloudTestMigrations);
}

export function useAlertingHarness() {
  return useHarness(cloudTestMigrations);
}
