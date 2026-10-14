// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { githubTasks } from "./registration";

const config = vi.hoisted(() => ({ enabled: false }));
const tasks = vi.hoisted(() => ({ "github-events/collector": vi.fn() }));
vi.mock("./configuration", () => ({
  getGithubConfiguration: () => (config.enabled ? {} : undefined),
}));
vi.mock("./events/tasks", () => ({ githubEventsTaskList: tasks }));
afterEach(() => {
  config.enabled = false;
});

describe("GitHub worker registration", () => {
  it("contributes no tasks when disabled", async () => {
    expect(await githubTasks()).toEqual({});
  });
  it("registers its tasks when enabled", async () => {
    config.enabled = true;
    expect(await githubTasks()).toBe(tasks);
  });
});
