import type { ParsedCronItem, TaskList } from "graphile-worker";

/** Executable commands and their schedules, not subscriptions to domain events. */
export interface WorkerTasks {
  taskList: TaskList;
  parsedCronItems: ParsedCronItem[];
}

/** Fail registration instead of silently replacing another feature's handler. */
export function combineWorkerTasks(...registrations: WorkerTasks[]): WorkerTasks {
  const taskList: TaskList = {};
  const parsedCronItems: ParsedCronItem[] = [];
  const cronIdentifiers = new Set<string>();
  for (const registration of registrations) {
    for (const [identifier, handler] of Object.entries(registration.taskList)) {
      if (Object.hasOwn(taskList, identifier))
        throw new Error(`Duplicate worker task: ${identifier}`);
      taskList[identifier] = handler;
    }
    for (const cron of registration.parsedCronItems) {
      if (cronIdentifiers.has(cron.identifier))
        throw new Error(`Duplicate worker schedule: ${cron.identifier}`);
      cronIdentifiers.add(cron.identifier);
      parsedCronItems.push(cron);
    }
  }
  for (const cron of parsedCronItems) {
    if (!taskList[cron.task]) throw new Error(`Missing scheduled worker task: ${cron.task}`);
  }
  return { taskList, parsedCronItems };
}
