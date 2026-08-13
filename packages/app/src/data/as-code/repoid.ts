/**
 * Repoid rules that govern every as-code kind, not just one of them.
 *
 * A Repoid is normally a repository slug (`host/owner/repo`) and is the apply
 * ownership and prune boundary: `everr apply` reconciles exactly one at a time,
 * removing anything inside it the applied tree does not contain.
 */

/**
 * The boundary resources created in the app are filed under.
 *
 * Such a resource has no repository behind it, so it needs a boundary no apply
 * ever targets. The `everr:` scheme cannot come from slug inference, which
 * always yields `host/owner/repo` — but a Manifest can name any non-empty
 * string, so the boundary holds only because `isReservedRepoid` rejects it
 * where apply reads its input. Take that check away and an `everr.yaml`
 * claiming this Repoid would prune everything the app has created.
 */
export const UI_REPOID = "everr:ui";

/**
 * Repoids the app owns and apply must never claim. Reserved by scheme prefix
 * rather than by listing values, so a second app-owned boundary inherits the
 * protection without another edit here.
 */
export function isReservedRepoid(repoid: string): boolean {
  return repoid.startsWith("everr:");
}
