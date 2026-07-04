import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreviewStatusBadge } from "./preview-status-badge";

describe("PreviewStatusBadge", () => {
  it("renders nothing without a status or when unchanged", () => {
    const { container: a } = render(<PreviewStatusBadge />);
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(<PreviewStatusBadge status="unchanged" />);
    expect(b).toBeEmptyDOMElement();
  });

  it("labels each visible status", () => {
    for (const [status, label] of [
      ["added", "Added"],
      ["changed", "Changed"],
      ["conflict", "Conflict"],
      ["removed", "Removed"],
    ] as const) {
      const { unmount } = render(<PreviewStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("explains a conflict on focus, pointing at --adopt", async () => {
    render(<PreviewStatusBadge status="conflict" />);
    fireEvent.focus(screen.getByText("Conflict"));
    expect(await screen.findByText(/--adopt/)).toBeInTheDocument();
  });
});
