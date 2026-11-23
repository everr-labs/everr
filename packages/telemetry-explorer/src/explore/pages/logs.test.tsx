import type * as LogsTypes from "../../logs";
import type { LogsExplorerProps } from "../../logs";
import { screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { fakeExploreBackend } from "../../testing/backend";
import { renderExplore } from "../../testing/explore";

vi.mock("../../logs", async (importOriginal) => ({
  ...(await importOriginal<typeof LogsTypes>()),
  LogsExplorer: ({ renderRunLink }: LogsExplorerProps) => (
    <div>
      <p>Logs page</p>
      {renderRunLink?.({ traceId: "trace-1", jobId: "job-1", stepNumber: "2" })}
    </div>
  ),
}));

it("shows a page inside the backend's gate", async () => {
  renderExplore(
    "/logs",
    fakeExploreBackend({
      Gate: ({ children }) => <section aria-label="Gate">{children}</section>,
    }),
  );

  expect(await screen.findByRole("region", { name: "Gate" })).toHaveTextContent("Logs page");
});

it("links a log row to its CI run only when the backend has CI runs", async () => {
  renderExplore(
    "/logs",
    fakeExploreBackend({
      ciRunLinks: {
        renderRunLink: ({ traceId, jobId, stepNumber }) => (
          <p>{`Run ${traceId} ${jobId} ${stepNumber}`}</p>
        ),
      },
    }),
  );

  expect(await screen.findByText("Run trace-1 job-1 2")).toBeInTheDocument();
});

it("renders a log row without a CI link when the backend has no CI runs", async () => {
  renderExplore("/logs");

  expect(await screen.findByText("Logs page")).toBeInTheDocument();
  expect(screen.queryByText(/^Run /)).not.toBeInTheDocument();
});
