import type { TimeRange } from "@everr/ui/lib/time-range";
import { describe, expect, it } from "vite-plus/test";
import type { LogsRepositoryLike } from "../../logs/data/repository";
import type { TracesRepositoryLike } from "../../traces/data/repository";
import { unionEnvironmentOptions, unionServiceOptions } from "./explore-filter-options";

const timeRange: TimeRange = { from: "now-1h", to: "now" };

function logsRepo(services: string[], environments: string[]) {
  return {
    filterOptions: async () => ({ services }),
    attributeValues: async () => environments,
  } as unknown as LogsRepositoryLike;
}

function tracesRepo(serviceNames: string[], environments: string[]) {
  return {
    listServiceIdentities: async () =>
      serviceNames.map((serviceName) => ({
        serviceName,
        serviceNamespace: "",
      })),
    attributeValues: async () => environments,
  } as unknown as TracesRepositoryLike;
}

const noMetrics = { services: async () => [], environments: async () => [] };

describe("unionServiceOptions", () => {
  it("unions logs + traces services, deduped and sorted", async () => {
    const options = unionServiceOptions(
      logsRepo(["web", "api"], []),
      tracesRepo(["api", "worker"], []),
      { timeRange, selected: [] },
      noMetrics,
    );
    const fetched = await options.queryFn();
    expect(options.select(fetched)).toEqual(["api", "web", "worker"]);
  });

  it("drops empty service names from either source", async () => {
    const options = unionServiceOptions(
      logsRepo(["web", ""], []),
      tracesRepo(["", "api"], []),
      {
        timeRange,
        selected: [],
      },
      noMetrics,
    );
    expect(options.select(await options.queryFn())).toEqual(["api", "web"]);
  });

  it("keeps a selected-but-unlisted service visible", async () => {
    const options = unionServiceOptions(
      logsRepo(["web"], []),
      tracesRepo(["api"], []),
      {
        timeRange,
        selected: ["aged-out"],
      },
      noMetrics,
    );
    expect(options.select(await options.queryFn())).toEqual(["aged-out", "api", "web"]);
  });
});

describe("with metrics", () => {
  const metricsRepo = {
    services: async () => ["collector", "api"],
    environments: async () => ["production", "canary"],
  };

  it("adds services that send only metrics", async () => {
    const options = unionServiceOptions(
      logsRepo(["web"], []),
      tracesRepo(["api"], []),
      { timeRange, selected: [] },
      metricsRepo,
    );
    expect(options.select(await options.queryFn())).toEqual(["api", "collector", "web"]);
  });

  it("adds environments that only metrics report", async () => {
    const options = unionEnvironmentOptions(
      logsRepo([], ["production"]),
      tracesRepo([], ["staging"]),
      { timeRange, selected: [] },
      metricsRepo,
    );
    expect(options.select(await options.queryFn())).toEqual(["canary", "production", "staging"]);
  });
});

describe("unionEnvironmentOptions", () => {
  it("unions logs + traces environments, deduped and sorted", async () => {
    const options = unionEnvironmentOptions(
      logsRepo([], ["production", "staging"]),
      tracesRepo([], ["staging", "dev"]),
      { timeRange, selected: [] },
      noMetrics,
    );
    expect(options.select(await options.queryFn())).toEqual(["dev", "production", "staging"]);
  });
});
