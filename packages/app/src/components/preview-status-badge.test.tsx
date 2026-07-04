import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreviewStatusBadge } from "./preview-status-badge";

describe("PreviewStatusBadge", () => {
  it("renders nothing without a status or when unchanged", () => {
    const { container: a } = render(<PreviewStatusBadge />);
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(<PreviewStatusBadge status="unchanged" />);
    expect(b).toBeEmptyDOMElement();
  });
});
