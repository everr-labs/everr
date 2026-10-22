import type { TaskList } from "graphile-worker";
import { getGithubConfiguration } from "./configuration";

export async function githubTasks(): Promise<TaskList> {
  if (!getGithubConfiguration()) return {};
  const { githubEventsTaskList } = await import(
    "../../server/github-events/tasks"
  );
  return githubEventsTaskList;
}
