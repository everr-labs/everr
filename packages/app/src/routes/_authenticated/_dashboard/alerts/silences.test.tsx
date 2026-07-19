import { describe, expect, it } from "vitest";
import { Route as SilencesFileRoute } from "./silences";

// The silences UI itself lives in the SilencesPanel component (tested at
// src/components/cc/silences-panel.test.tsx) and renders on the Triage page;
// this route only preserves old deep links.
describe("/alerts/silences route", () => {
  it("redirects to the Triage page's silences section", () => {
    let thrown: unknown;
    try {
      SilencesFileRoute.options.beforeLoad?.({} as never);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const options = (thrown as { options: { to: string; hash: string } })
      .options;
    expect(options.to).toBe("/alerts/triage");
    expect(options.hash).toBe("silences");
  });
});
