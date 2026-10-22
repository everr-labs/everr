import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";

type Vars = Record<string, string | string[]>;
const state = vi.hoisted(() => {
  const latestVars: Vars = { env: "prod" };
  return { latestVars, navigate: vi.fn() };
});
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useSearch: () => ({ env: "prod" }),
}));
vi.mock("./use-dashboard-variables", () => ({
  useDashboardVariables: () => ({
    variables: [{ kind: "TextVariable", spec: { name: "env" } }],
    values: { env: "prod" },
    optionsState: {},
  }),
}));

import { VariableBar } from "./variable-bar";

it("merges a variable edit into the latest navigation search state", () => {
  state.navigate.mockImplementation(
    ({ search }: { search: (previous: { vars: Vars }) => { vars: Vars } }) => {
      state.latestVars = search({ vars: state.latestVars }).vars;
      return Promise.resolve();
    },
  );
  render(<VariableBar />);
  const field = screen.getByRole("textbox", { name: "env" });
  fireEvent.change(field, { target: { value: "staging" } });
  // Another navigation can update search after render and before this commit.
  state.latestVars = { env: "prod", region: "west" };
  fireEvent.blur(field);
  expect(state.latestVars).toEqual({ env: "staging", region: "west" });
});
