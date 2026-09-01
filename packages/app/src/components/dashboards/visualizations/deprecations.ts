/**
 * A panel option that still parses but no longer does what it says.
 *
 * Removing such an option outright would break every stored panel that sets
 * it — the dashboard would fail to apply and the panel would lose its other
 * options to the schema fallback. So the value stays accepted, the renderer
 * ignores it, and both surfaces that can reach the author (the panel header
 * and `everr apply`) say so until the file is migrated.
 */
export interface SpecDeprecation {
  /** Option path within the plugin spec, e.g. `curveType`. */
  option: string;
  /** What the panel does now, for someone looking at it. */
  message: string;
  /** The edit that resolves it, phrased as an instruction to an agent. */
  fix: string;
}

/**
 * The handoff prompt for migrating a panel off deprecated options. Dashboards
 * are as-code documents reconciled by apply, so the fix belongs in the YAML
 * file, not in a UI the app doesn't offer (ADR 0004) — this hands the Agent
 * the panel, the options, and the edit, and lets it find the file.
 *
 * It deliberately does NOT say to run `everr apply`: plenty of repositories
 * apply from CI on merge, where an apply from someone's machine is at best
 * redundant and at worst a write from an unreviewed working tree. The edit is
 * the ask; how it ships is the repository's own convention to follow.
 */
export function deprecatedOptionsPrompt(input: {
  panelName: string;
  deprecations: SpecDeprecation[];
}): string {
  const list = input.deprecations
    .map((d) => `- \`${d.option}\`: ${d.fix}`)
    .join("\n");
  return `/everr-setup-resources The panel "${input.panelName}" in this repository's as-code dashboards uses options Everr has deprecated:\n${list}\n\nFind the file that defines this panel and make those edits. Check the repository's other dashboards and runbooks for the same options while you are there, then ship the change the way this repository already delivers as-code resources — if a pipeline runs \`everr apply\`, commit and let it; only apply by hand if that is how this repository does it.`;
}
