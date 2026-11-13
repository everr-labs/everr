import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { FilterSearchBar } from "./filter-search-bar";

describe("FilterSearchBar", () => {
  it("preserves unsubmitted drafts until an external value changes", () => {
    const onChange = vi.fn();
    const field = (value: string) => (
      <FilterSearchBar
        id="s"
        label="Search"
        value={value}
        onChange={onChange}
        placeholder="Search messages"
      />
    );
    const { rerender } = render(field("old"));
    const input = screen.getByLabelText("Search");
    fireEvent.change(input, { target: { value: "unsubmitted draft" } });
    rerender(field("old"));
    expect(input).toHaveValue("unsubmitted draft");

    rerender(field("external"));
    expect(input).toHaveValue("external");
    expect(onChange).not.toHaveBeenCalled();
  });

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

  it("shows a clear button named after its field only when a value is committed", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterSearchBar id="s" label="Trace" value="" onChange={onChange} placeholder="p" />,
    );
    expect(screen.queryByRole("button", { name: "Clear trace" })).not.toBeInTheDocument();

    rerender(
      <FilterSearchBar id="s" label="Trace" value="abc123" onChange={onChange} placeholder="p" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear trace" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("commits the trimmed draft on blur only when it differs from the committed value", () => {
    const onChange = vi.fn();
    render(
      <FilterSearchBar id="s" label="Search" value="boom" onChange={onChange} placeholder="p" />,
    );
    const input = screen.getByLabelText("Search");
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();

    // Leaving the field runs the search.
    fireEvent.change(input, { target: { value: " bang " } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("bang");
  });

  it("hides the clear button while the input has focus, and only then", () => {
    render(
      <FilterSearchBar id="s" label="Search" value="boom" onChange={vi.fn()} placeholder="p" />,
    );
    const input = screen.getByLabelText("Search");
    const clear = () => screen.queryByRole("button", { name: "Clear search" });
    expect(clear()).toBeInTheDocument();

    // Focus on the input swaps in the Enter hint.
    fireEvent.focus(input);
    expect(screen.getByText("Enter")).toBeInTheDocument();
    expect(clear()).not.toBeInTheDocument();

    // Focus on the clear button itself must not take it off the layout, which
    // would drop the focus and swallow the activation.
    fireEvent.blur(input);
    const button = clear();
    expect(button).toBeInTheDocument();
    fireEvent.focus(button as HTMLElement);
    expect(clear()).toBeInTheDocument();
  });
});
