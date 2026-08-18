import { describe, expect, it } from "vitest";
import { alertingRuleViewFixture } from "../../test-fixtures";
import { rulesForPreview } from "./preview-overlay";

const scopes = [{ id: "pr-1", repoid: "repo-1" }];

const live = (name: string, over = {}) =>
  alertingRuleViewFixture({
    id: `live-${name}`,
    name: `default/${name}`,
    repoid: "repo-1",
    previewId: null,
    ...over,
  });

const onBranch = (name: string, over = {}) =>
  alertingRuleViewFixture({
    id: `pr-${name}`,
    name: `default/${name}`,
    repoid: "repo-1",
    previewId: "pr-1",
    ...over,
  });

const statusByName = (rules: { name: string; previewStatus?: string }[]) =>
  Object.fromEntries(rules.map((rule) => [rule.name, rule.previewStatus]));

describe("rulesForPreview", () => {
  it("keeps only live rules when no preview is named", () => {
    const out = rulesForPreview([live("kept"), onBranch("hidden")], null);

    expect(out.map((rule) => rule.name)).toEqual(["default/kept"]);
    expect(out[0].previewStatus).toBeUndefined();
  });

  it("tags a branch's rule against the live rule it replaces", () => {
    const out = rulesForPreview(
      [
        live("edited"),
        live("untouched"),
        live("deleted"),
        onBranch("edited", { spec: { interval_secs: 300 } }),
        onBranch("untouched"),
        onBranch("brand-new"),
      ],
      scopes,
    );

    expect(statusByName(out)).toEqual({
      "default/edited": "changed",
      "default/untouched": "unchanged",
      "default/deleted": "removed",
      "default/brand-new": "added",
    });
  });

  // The channels a rule notifies live beside the spec, not inside it, so a
  // branch that only re-routes a rule must still read as changed.
  it("counts a re-routed rule as changed even with an identical spec", () => {
    const out = rulesForPreview(
      [
        live("paged", { notifications: { channels: ["team-slack"] } }),
        onBranch("paged", { notifications: { channels: ["pagerduty"] } }),
      ],
      scopes,
    );

    expect(statusByName(out)).toEqual({ "default/paged": "changed" });
  });

  // Every preview's rows come back in one read of the definitions table.
  it("ignores rules belonging to another branch", () => {
    const other = alertingRuleViewFixture({
      id: "pr-other",
      name: "default/elsewhere",
      repoid: "repo-1",
      previewId: "pr-2",
    });

    const out = rulesForPreview([live("kept"), other], scopes);

    expect(out.map((rule) => rule.name)).toEqual(["default/kept"]);
  });

  it("leaves rules of repos the branch does not cover untagged", () => {
    const elsewhere = alertingRuleViewFixture({
      id: "live-elsewhere",
      name: "default/elsewhere",
      repoid: "repo-2",
      previewId: null,
    });

    const out = rulesForPreview([elsewhere, onBranch("brand-new")], scopes);

    expect(statusByName(out)).toEqual({
      "default/elsewhere": undefined,
      "default/brand-new": "added",
    });
  });
});
