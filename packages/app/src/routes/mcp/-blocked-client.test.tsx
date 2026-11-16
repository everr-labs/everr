import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ search: {} as { redirect_uri?: string } }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useSearch: () => mocks.search,
  }),
}));

import { Route } from "./blocked-client";

beforeEach(() => {
  mocks.search = {};
});

function renderPage() {
  const Component = Route.options.component as React.ComponentType;
  return render(<Component />);
}

it("names the blocked destination and prefills a report with the callback URI", () => {
  const callback = "https://attacker.example/cb?x=1&y=2";
  mocks.search = { redirect_uri: callback };
  renderPage();

  expect(screen.getByText("attacker.example")).toBeVisible();
  expect(screen.getByText(callback)).toBeVisible();
  expect(screen.getByRole("button", { name: "Copy callback URI" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Setup guide" })).toHaveAttribute(
    "href",
    "https://everr.dev/docs/reference/mcp",
  );

  const issue = new URL(
    screen.getByRole("link", { name: "Open a GitHub issue" }).getAttribute("href")!,
  );
  expect(issue.origin + issue.pathname).toBe("https://github.com/everr-labs/everr/issues/new");
  expect(issue.searchParams.get("title")).toContain(callback);
  expect(issue.searchParams.get("body")).toContain(`Callback URI: ${callback}`);

  const mail = screen.getByRole("link", { name: "email hello@everr.dev" }).getAttribute("href")!;
  expect(mail.startsWith("mailto:hello@everr.dev?")).toBe(true);
  expect(decodeURIComponent(mail)).toContain(`Callback URI: ${callback}`);
});

it("renders a hostile value as text", () => {
  const hostile = '<img src=x onerror="alert(1)">';
  mocks.search = { redirect_uri: hostile };
  const { container } = renderPage();

  expect(screen.getByText(hostile)).toBeVisible();
  expect(screen.getByText("An unknown address")).toBeVisible();
  expect(container.querySelector("img")).toBeNull();
});

it("still guides the user when the callback URI is missing", () => {
  renderPage();

  expect(screen.getByText("An unknown address")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Copy callback URI" })).toBeNull();
  expect(screen.getByRole("link", { name: "Open a GitHub issue" })).toBeVisible();
});
