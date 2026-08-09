import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALERTING_POLL_INTERVAL_MS } from "../polling";

const mocks = vi.hoisted(() => ({
  listAlertingRulesPage: vi.fn(),
}));

vi.mock("./server", () => ({
  getAlertingRule: vi.fn(),
  getAlertingRuleByName: vi.fn(),
  getAlertingRuleEvaluationSeries: vi.fn(),
  listAlertingRules: vi.fn(),
  listAlertingRulesPage: mocks.listAlertingRulesPage,
}));

import { ruleQueries } from "./queries";

describe("ruleQueries.rulesPage polling", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
    mocks.listAlertingRulesPage.mockReset();
  });

  afterEach(() => {
    queryClient.clear();
    vi.useRealTimers();
  });

  it("keeps refreshing every loaded page for an organization with two pages", async () => {
    // Cursor-keyed so every refetch of page 1 still chains to page 2,
    // regardless of how many times the interval re-fetches both pages.
    mocks.listAlertingRulesPage.mockImplementation(
      async ({ data }: { data: { cursor?: string } }) =>
        data.cursor
          ? { items: [], next_cursor: null }
          : { items: [], next_cursor: "cursor-1" },
    );

    const observer = new InfiniteQueryObserver(
      queryClient,
      ruleQueries.rulesPage(),
    );

    let resolveFirstFetch: () => void = () => {};
    const firstFetch = new Promise<void>((resolve) => {
      resolveFirstFetch = resolve;
    });
    const unsubscribe = observer.subscribe((result) => {
      if (result.isSuccess) resolveFirstFetch();
    });
    await firstFetch;
    expect(mocks.listAlertingRulesPage).toHaveBeenCalledTimes(1);

    await observer.fetchNextPage();
    expect(mocks.listAlertingRulesPage).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data?.pages).toHaveLength(2);

    // Polling must not silently stop once a second page is loaded.
    await vi.advanceTimersByTimeAsync(ALERTING_POLL_INTERVAL_MS);
    expect(mocks.listAlertingRulesPage).toHaveBeenCalledTimes(4);

    unsubscribe();
  });
});
