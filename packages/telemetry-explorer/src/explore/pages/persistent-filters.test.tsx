import type * as FiltersTypes from "../../filters";
import type * as LogsTypes from "../../logs";
import type { LogsExplorerProps } from "../../logs";
/**
 * Regression test for: selecting a Service/Environment filter redirects to "/".
 *
 * Root cause: a navigate bound to the pathless Explore layout route takes that
 * route's `fullPath` as `from`, which is `"/"`. Calling it with a `search` and
 * no `to` then resolves the target as `"/"`, the home page.
 *
 * The navigate under test is in `ExplorePersistentFilters`. Each Explore page
 * puts that component in its filter rail. It must continue to patch the search
 * with a navigate that is bound to no route.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vite-plus/test";
import { renderExplore } from "../../testing/explore";

vi.mock("../../filters", async (importOriginal) => ({
  ...(await importOriginal<typeof FiltersTypes>()),
  ExploreGlobalFilters: ({ onServiceChange }: { onServiceChange: (v: string[]) => void }) => (
    <button type="button" onClick={() => onServiceChange(["api"])}>
      Set service
    </button>
  ),
}));

vi.mock("../../logs", async (importOriginal) => ({
  ...(await importOriginal<typeof LogsTypes>()),
  LogsExplorer: ({ persistentFilters }: LogsExplorerProps) => <div>{persistentFilters}</div>,
}));

it("stays on /logs after changing the service filter", async () => {
  const user = userEvent.setup();
  const { router } = renderExplore("/logs");
  const navigate = vi.spyOn(router, "navigate");

  await user.click(await screen.findByRole("button", { name: "Set service" }));

  await waitFor(() => expect(navigate).toHaveBeenCalled());
  // A navigate bound to the pathless layout passes `from: "/"`, which is the
  // signature of the bug.
  expect(navigate.mock.calls[0]?.[0].from).not.toBe("/");

  await waitFor(() => expect(router.state.location.search).toMatchObject({ service: ["api"] }));
  expect(router.state.location.pathname).toBe("/logs");
});
