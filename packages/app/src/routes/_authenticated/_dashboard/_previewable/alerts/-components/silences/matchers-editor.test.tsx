import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertingMatcher } from "@/data/alerting/types";
import {
  addMatcher,
  MatchersEditor,
  matchersAreScoped,
  removeMatcher,
  updateMatcher,
} from "./matchers-editor";

const mocks = vi.hoisted(() => ({
  listAlertingLabelKeys: vi.fn(),
  listAlertingLabelValues: vi.fn(),
}));

vi.mock("@/data/alerting/routing/suggestions", () => ({
  listAlertingLabelKeys: mocks.listAlertingLabelKeys,
  listAlertingLabelValues: mocks.listAlertingLabelValues,
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
  // An empty-label matcher does not narrow the alert set.
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

function renderEditor(initial: AlertingMatcher[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const latest: { matchers: AlertingMatcher[] } = { matchers: initial };

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
    mocks.listAlertingLabelKeys.mockResolvedValue([
      { key: "severity", synthetic: true },
      { key: "svc", synthetic: false },
    ]);
    mocks.listAlertingLabelValues.mockResolvedValue([]);
  });

  it("suggests values for the row's selected key", async () => {
    mocks.listAlertingLabelValues.mockResolvedValue([{ value: "flap" }]);
    const user = userEvent.setup();
    const latest = renderEditor([{ label: "svc", op: "eq", value: "" }]);

    await user.click(screen.getByRole("combobox", { name: "Matcher value" }));
    await user.click(await screen.findByText("flap"));

    expect(mocks.listAlertingLabelValues).toHaveBeenCalledWith({
      data: { key: "svc" },
    });
    expect(latest.matchers).toEqual([
      { label: "svc", op: "eq", value: "flap" },
    ]);
  });

  // Matching is exact only, so the operator menu offers no pattern ops.
  it("offers only the exact-match operators", async () => {
    const user = userEvent.setup();
    renderEditor([{ label: "svc", op: "eq", value: "" }]);

    await user.click(
      screen.getByRole("combobox", { name: "Matcher operator" }),
    );

    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["=", "≠"]);
  });
});
