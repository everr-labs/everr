import type { ExploreBackend } from "../explore/backend";

type Repos = ExploreBackend["repos"];

/**
 * A backend for router tests. Its repositories have only the methods a test
 * gives them: a test that never opens an Explore page, or that replaces the
 * explorer components with stand-ins, needs none.
 */
export function fakeExploreBackend(
  overrides: Partial<Omit<ExploreBackend, "repos">> & {
    repos?: { [Name in keyof Repos]?: Partial<Repos[Name]> };
  } = {},
): ExploreBackend {
  const { repos, ...rest } = overrides;
  return {
    useErrorTraceSpans: () => ({ spans: [], isPending: false, isError: false, refetch: () => {} }),
    ...rest,
    repos: {
      logs: { ...repos?.logs } as Repos["logs"],
      traces: { ...repos?.traces } as Repos["traces"],
      metrics: { ...repos?.metrics } as Repos["metrics"],
      errors: { ...repos?.errors } as Repos["errors"],
    },
  };
}
