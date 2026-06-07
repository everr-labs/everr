import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Panel } from "@/data/dashboards/schema";
import { QueryEditor } from "./query-editor";

vi.mock("./sql-editor", () => ({
  SqlEditor: ({
    defaultValue,
    onChange,
  }: {
    defaultValue: string;
    onChange: (t: string) => void;
  }) => (
    <textarea
      aria-label="sql"
      defaultValue={defaultValue}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

function panelWith(queries: string[]): Panel {
  return {
    kind: "Panel",
    spec: {
      display: { name: "p" },
      plugin: { kind: "Table", spec: {} },
      queries: queries.map((query) => ({
        kind: "ClickHouseSQL",
        spec: { plugin: { kind: "ClickHouseSQL", spec: { query } } },
      })),
    },
  };
}

function Harness({ initial }: { initial: Panel }) {
  const [draft, setDraft] = useState(initial);
  return (
    <QueryEditor draft={draft} onChange={setDraft} onRunQuery={() => {}} />
  );
}

describe("QueryEditor", () => {
  it("renders one editor per query", () => {
    render(<Harness initial={panelWith(["a", "b"])} />);
    expect(screen.getAllByLabelText("sql")).toHaveLength(2);
  });

  it("adds a query", async () => {
    render(<Harness initial={panelWith(["a"])} />);
    await userEvent.click(screen.getByRole("button", { name: /add query/i }));
    expect(screen.getAllByLabelText("sql")).toHaveLength(2);
  });

  it("removes a query", async () => {
    render(<Harness initial={panelWith(["a", "b"])} />);
    await userEvent.click(
      screen.getAllByRole("button", { name: /remove query/i })[0]!,
    );
    expect(screen.getAllByLabelText("sql")).toHaveLength(1);
  });

  it("calls onRunQuery with the query's index", async () => {
    const onRun = vi.fn();
    render(
      <QueryEditor
        draft={panelWith(["a", "b"])}
        onChange={() => {}}
        onRunQuery={onRun}
      />,
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: /run query/i })[1]!,
    );
    expect(onRun).toHaveBeenCalledWith(1);
  });
});
