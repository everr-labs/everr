import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CcMatcher } from "@/data/cc/types";
import {
  addMatcher,
  MatchersEditor,
  matchersAreScoped,
  removeMatcher,
  updateMatcher,
} from "./matchers-editor";

const mocks = vi.hoisted(() => ({
  listCcLabelKeys: vi.fn(),
  listCcLabelValues: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  listCcLabelKeys: mocks.listCcLabelKeys,
  listCcLabelValues: mocks.listCcLabelValues,
}));

it("adds, updates, removes matcher rows", () => {
  let m = addMatcher([]);
  expect(m).toEqual([{ label: "", op: "eq", value: "" }]);
  m = updateMatcher(m, 0, { label: "severity", value: "critical" });
  expect(m[0]).toEqual({ label: "severity", op: "eq", value: "critical" });
  m = removeMatcher(m, 0);
  expect(m).toEqual([]);
});

it("treats a set as scoped only when every matcher has a label", () => {
  expect(matchersAreScoped([])).toBe(false);
  // A fresh `addMatcher` row has an empty label, which the engine matches
  // against every alert (missing label reads as ""): not scoped.
  expect(matchersAreScoped(addMatcher([]))).toBe(false);
  expect(matchersAreScoped([{ label: "  ", op: "eq", value: "" }])).toBe(false);
  expect(matchersAreScoped([{ label: "svc", op: "eq", value: "" }])).toBe(true);
  expect(
    matchersAreScoped([
      { label: "svc", op: "eq", value: "api" },
      { label: "", op: "eq", value: "" },
    ]),
  ).toBe(false);
});

// ---------------------------------------------------------------------------
// Combobox behavior
// ---------------------------------------------------------------------------

function renderEditor(initial: CcMatcher[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const latest: { matchers: CcMatcher[] } = { matchers: initial };

  function Harness() {
    const [matchers, setMatchers] = useState(initial);
    latest.matchers = matchers;
    return <MatchersEditor value={matchers} onChange={setMatchers} />;
  }

  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return latest;
}

describe("MatchersEditor comboboxes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCcLabelKeys.mockResolvedValue([
      { key: "severity", synthetic: true },
      { key: "svc", synthetic: false },
    ]);
    mocks.listCcLabelValues.mockResolvedValue([]);
  });

  it("suggests observed and synthetic keys, tagging the synthetic ones", async () => {
    const user = userEvent.setup();
    renderEditor([{ label: "", op: "eq", value: "" }]);

    await user.click(screen.getByRole("combobox", { name: "Matcher label" }));

    expect(await screen.findByText("severity")).toBeInTheDocument();
    expect(screen.getByText("synthetic")).toBeInTheDocument();
    expect(screen.getByText("svc")).toBeInTheDocument();
  });

  it("suggests values for the row's selected key", async () => {
    mocks.listCcLabelValues.mockResolvedValue([{ value: "flap" }]);
    const user = userEvent.setup();
    const latest = renderEditor([{ label: "svc", op: "eq", value: "" }]);

    await user.click(screen.getByRole("combobox", { name: "Matcher value" }));
    await user.click(await screen.findByText("flap"));

    expect(mocks.listCcLabelValues).toHaveBeenCalledWith({
      data: { key: "svc" },
    });
    expect(latest.matchers).toEqual([
      { label: "svc", op: "eq", value: "flap" },
    ]);
  });

  it("commits a typed custom value that no suggestion offers", async () => {
    mocks.listCcLabelValues.mockResolvedValue([{ value: "flap" }]);
    const user = userEvent.setup();
    const latest = renderEditor([{ label: "svc", op: "eq", value: "" }]);

    await user.click(screen.getByRole("combobox", { name: "Matcher value" }));
    await user.type(
      screen.getByPlaceholderText("Search or type..."),
      "not-in-the-list",
    );
    await user.click(screen.getByText('"not-in-the-list"'));

    expect(latest.matchers).toEqual([
      { label: "svc", op: "eq", value: "not-in-the-list" },
    ]);
  });

  it("falls back to a free-text input for regex operators", async () => {
    const user = userEvent.setup();
    const latest = renderEditor([{ label: "svc", op: "regex", value: "" }]);

    const field = screen.getByLabelText("Matcher value");
    expect(field.tagName).toBe("INPUT");
    await user.type(field, "^web-.*$");

    expect(latest.matchers).toEqual([
      { label: "svc", op: "regex", value: "^web-.*$" },
    ]);
    // No suggestion fetch for an authored pattern.
    expect(mocks.listCcLabelValues).not.toHaveBeenCalled();
  });
});
