import type * as TelemetryErrors from "../../errors";
import type { ErrorDetailProps, ErrorIssuesProps } from "../../errors";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderExplore } from "../../testing/explore";

vi.mock("../../errors", async (importOriginal) => {
  const actual = await importOriginal<typeof TelemetryErrors>();
  return {
    ...actual,
    ErrorDetail: ({ fingerprint, onBack, onClose }: ErrorDetailProps) => (
      <div>
        <div>Error detail page {fingerprint}</div>
        {onBack && (
          <button type="button" onClick={onBack}>
            Back to errors
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose}>
            Close detail
          </button>
        )}
      </div>
    ),
    ErrorIssues: ({
      renderIssueLink,
      search,
    }: Pick<ErrorIssuesProps, "renderIssueLink" | "search">) => (
      <div>
        <div>Error list page</div>
        <div data-testid="errors-search">{JSON.stringify(search)}</div>
        {renderIssueLink({
          fingerprint: "fp-1",
          className: "",
          children: "Open error fp-1",
        })}
      </div>
    ),
  };
});

describe("/errors route", () => {
  it.each([
    "/errors/fp-1",
    "/errors/fp-1?from=2026-06-04%2018%3A45%3A10.869&to=2026-06-04%2018%3A55%3A10.869",
  ])("renders the detail as a page for a direct or reloaded URL %s", async (url) => {
    renderExplore(url);

    expect(await screen.findByText("Error detail page fp-1")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Error list page")).not.toBeInTheDocument();
  });

  it("renders the detail in a modal from the list, under the full page's URL", async () => {
    const user = userEvent.setup();
    const { router } = renderExplore("/errors");

    await user.click(await screen.findByRole("link", { name: "Open error fp-1" }));

    const dialog = await screen.findByRole("dialog", { name: "Error detail" });
    expect(within(dialog).getByText("Error detail page fp-1")).toBeInTheDocument();
    expect(screen.getByText("Error list page")).toBeInTheDocument();
    expect(router.state.location.href).toContain("/modal");
    expect(router.state.location.maskedLocation?.href).not.toContain("/modal");
    expect(router.state.location.maskedLocation?.href).toContain("/errors/fp-1");
  });

  it("closes the modal back to the list", async () => {
    const user = userEvent.setup();
    const { router } = renderExplore("/errors?q=timeout");
    await user.click(await screen.findByRole("link", { name: "Open error fp-1" }));

    await user.click(await screen.findByRole("button", { name: "Close detail" }));

    await screen.findByText("Error list page");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/errors");
    expect(router.state.location.search).toEqual({ q: "timeout" });
  });

  it("goes from the full page back to the list", async () => {
    const user = userEvent.setup();
    const { router } = renderExplore("/errors/fp-1?q=timeout&occurrence=abc");

    await user.click(await screen.findByRole("button", { name: "Back to errors" }));

    expect(await screen.findByText("Error list page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/errors");
    expect(router.state.location.search).toEqual({ q: "timeout" });
  });

  it("renders the list page after dropping invalid empty query params", async () => {
    const { router } = renderExplore(
      "/errors?q=&service=&fingerprint=&occurrence=&sort=lastSeen&attributes=&from=now-30d",
    );

    expect(await screen.findByText("Error list page")).toBeInTheDocument();
    expect(router.state.location.href).toBe("/errors?from=now-30d");
    expect(screen.getByTestId("errors-search")).toHaveTextContent(
      JSON.stringify({
        q: "",
        service: [],
        fingerprint: "",
        sort: "lastSeen",
        attributes: [],
      }),
    );
  });
});
