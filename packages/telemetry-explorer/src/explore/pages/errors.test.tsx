import type * as TelemetryErrors from "../../errors";
import type { ErrorDetailProps, ErrorIssuesProps } from "../../errors";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderExplore } from "../../testing/explore";

vi.mock("../../errors", async (importOriginal) => {
  const actual = await importOriginal<typeof TelemetryErrors>();
  return {
    ...actual,
    ErrorDetail: ({ fingerprint, onBack }: ErrorDetailProps) => (
      <div>
        <div>Error detail page {fingerprint}</div>
        {onBack && (
          <button type="button" onClick={onBack}>
            Back to errors
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
  ])("renders the detail for a direct or reloaded URL %s", async (url) => {
    renderExplore(url);

    expect(await screen.findByText("Error detail page fp-1")).toBeInTheDocument();
  });

  it("opens an error over the list, keeping the list filters", async () => {
    const user = userEvent.setup();
    const { router } = renderExplore("/errors?q=timeout");
    const list = await screen.findByText("Error list page");

    await user.click(screen.getByRole("link", { name: "Open error fp-1" }));

    expect(await screen.findByText("Error detail page fp-1")).toBeInTheDocument();
    expect(list.closest("[inert]")).not.toBeNull();
    expect(router.state.location.pathname).toBe("/errors/fp-1");
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
        withRecording: false,
      }),
    );
  });
});
