// @vitest-environment node
import { parseCronItems } from "graphile-worker";
import { expect, it, vi } from "vite-plus/test";
import { combineWorkerTasks } from "./task-registration";

it("refuses an ambiguous task handler", () => {
  const registration = { taskList: { task: vi.fn() }, parsedCronItems: [] };
  expect(() => combineWorkerTasks(registration, registration)).toThrow(
    "Duplicate worker task: task",
  );
});

it("refuses duplicate schedule identities even with different tasks", () => {
  const registration = (task: string) => ({
    taskList: { [task]: vi.fn() },
    parsedCronItems: parseCronItems([{ task, match: "* * * * *", identifier: "scan" }]),
  });
  expect(() => combineWorkerTasks(registration("one"), registration("two"))).toThrow(
    "Duplicate worker schedule: scan",
  );
});

it("refuses a schedule without an executable handler", () => {
  expect(() =>
    combineWorkerTasks({
      taskList: {},
      parsedCronItems: parseCronItems([{ task: "missing", match: "* * * * *" }]),
    }),
  ).toThrow("Missing scheduled worker task: missing");
});
