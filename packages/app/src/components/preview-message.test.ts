import { describe, expect, it } from "vitest";
import { previewMessage } from "./preview-message";

describe("previewMessage", () => {
  it("names the preview in generic copy when there's no status", () => {
    expect(previewMessage("gio/apply-previews")).toBe(
      'Previewing "gio/apply-previews" — applied resources are overlaid on live.',
    );
  });

  it("tailors the copy to each per-resource status", () => {
    expect(previewMessage("p", "added")).toContain("New in preview");
    expect(previewMessage("p", "changed")).toContain("differs from live");
    expect(previewMessage("p", "unchanged")).toContain("unchanged from live");
    expect(previewMessage("p", "removed")).toContain(
      "viewing the live version",
    );
  });
});
