import type * as ErrorsTypes from "../errors";
import type { ErrorIssuesProps } from "../errors";
import type * as FiltersTypes from "../filters";
import type * as LogsTypes from "../logs";
import type { LogsExplorerProps } from "../logs";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderExplore } from "../testing/explore";
import { errorsRoute, exploreLayoutRoute, logsRoute, metricsRoute, tracesRoute } from "./routes";

vi.mock("../filters", async (importOriginal) => ({
  ...(await importOriginal<typeof FiltersTypes>()),
  ExploreGlobalFilters: ({
    service,
    onServiceChange,
  }: {
    service: string[];
    onServiceChange: (next: string[]) => void;
  }) => (
    <div>
      <p>{`Service filter: ${service.join(", ") || "none"}`}</p>
      <button type="button" onClick={() => onServiceChange([])}>
        Clear service
      </button>
    </div>
  ),
}));

vi.mock("../logs", async (importOriginal) => ({
  ...(await importOriginal<typeof LogsTypes>()),
  LogsExplorer: ({ persistentFilters }: LogsExplorerProps) => (
    <div>
      <p>Logs page</p>
      {persistentFilters}
    </div>
  ),
}));

vi.mock("../errors", async (importOriginal) => ({
  ...(await importOriginal<typeof ErrorsTypes>()),
  ErrorIssues: ({ persistentFilters }: ErrorIssuesProps) => (
    <div>
      <p>Errors page</p>
      {persistentFilters}
    </div>
  ),
}));

// Regression test for: service/environment being stripped by child-route
// validateSearch when navigating between Explore sections.
//
// Root cause: child schemas used .omit({ service: true }) (and never included
// environment), so Zod's strict object stripping discarded those params on
// arrival at the leaf route. The fix spreads ExploreSearchShape into every
// child schema, mirroring how TimeRangeSearchSchema carries from/to.
it.each([
  ["logs", logsRoute],
  ["errors", errorsRoute],
  ["traces", tracesRoute],
  ["metrics", metricsRoute],
  ["explore layout", exploreLayoutRoute],
] as const)("%s schema preserves service and environment", (_name, route) => {
  const out = route.validateSearch.parse({ service: ["api"], environment: ["prod"] });
  expect(out.service).toEqual(["api"]);
  expect(out.environment).toEqual(["prod"]);
});

/**
 * Regression test for: clearing a Service/Environment filter back to empty must
 * remove it from the URL, not silently re-apply the previous value.
 *
 * The Explore filters are persisted with `retainSearchParams` (so sidebar /
 * cross-section navigation keeps them) and cleaned up with `stripSearchParams`
 * (so the default empty array stays out of the URL). The two only coexist when
 * the schemas are OPTIONAL (no `.default([])`):
 *
 *   - cross-route nav: the key arrives absent, retain copies the live value;
 *   - explicit clear (service: []): the value is present, strip drops it as a
 *     default and retain, which only refills absent keys, leaves it gone.
 *
 * With a schema default, every destination already carries `[]`, retain can
 * never fire (persistence breaks) AND a strip-then-retain re-injects a cleared
 * value (clears never stick). This test exercises set / clear / cross-route
 * persistence end to end, over the real middleware chain.
 */
describe("explore filter clear + persistence", () => {
  it("retains a set service across sections and removes it from the URL when cleared", async () => {
    const user = userEvent.setup();
    const { router } = renderExplore('/logs?service=["alert"]');
    await screen.findByText("Logs page");
    expect(screen.getByText("Service filter: alert")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Errors" }));

    await screen.findByText("Errors page");
    expect(router.state.location.pathname).toBe("/errors");
    expect(router.state.location.search.service).toEqual(["alert"]);
    expect(screen.getByText("Service filter: alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear service" }));

    await waitFor(() => expect(router.state.location.search.service).toBeUndefined());
    expect(router.state.location.href).toBe("/errors");
    expect(screen.getByText("Service filter: none")).toBeInTheDocument();
  });
});
