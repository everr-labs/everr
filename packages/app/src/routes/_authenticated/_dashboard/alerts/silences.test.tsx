import { describe, expect, it } from "vitest";
import { Route as SilencesFileRoute } from "./silences";

// The panel is tested separately; this route preserves old deep links.
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
