import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterSearchBar } from "./filter-search-bar";

describe("FilterSearchBar", () => {
  it("commits the trimmed draft on submit", () => {
    const onChange = vi.fn();
    render(
      <FilterSearchBar
        id="logs-search"
        label="Search logs"
        value=""
        onChange={onChange}
        placeholder="Search messages"
      />,
    );
    const input = screen.getByLabelText("Search logs");
    fireEvent.change(input, { target: { value: "  boom  " } });
    fireEvent.submit(input);
    expect(onChange).toHaveBeenCalledWith("boom");
  });

  it("shows a clear button only when a value is committed and clears it", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterSearchBar
        id="s"
        label="Search"
        value=""
        onChange={onChange}
        placeholder="p"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).not.toBeInTheDocument();

    rerender(
      <FilterSearchBar
        id="s"
        label="Search"
        value="boom"
        onChange={onChange}
        placeholder="p"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
  it("commits the draft on blur so leaving the field runs the search", () => {
    const onChange = vi.fn();
    render(
      <FilterSearchBar
        id="s"
        label="Search"
        value=""
        onChange={onChange}
        placeholder="p"
      />,
    );
    const input = screen.getByLabelText("Search");
    fireEvent.change(input, { target: { value: " boom " } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("boom");
  });

  it("does not commit on blur when the draft matches the committed value", () => {
    const onChange = vi.fn();
    render(
      <FilterSearchBar
        id="s"
        label="Search"
        value="boom"
        onChange={onChange}
        placeholder="p"
      />,
    );
    fireEvent.blur(screen.getByLabelText("Search"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("names the clear button after the field it clears", () => {
    render(
      <FilterSearchBar
        id="logs-trace-id"
        label="Trace"
        value="abc123"
        onChange={vi.fn()}
        placeholder="Any trace"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Clear trace" }),
    ).toBeInTheDocument();
  });
});
