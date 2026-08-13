/**
 * The Repoid every Dashboard created in the app is filed under.
 *
 * A Repoid is normally a repository slug (`host/owner/repo`), and `everr apply`
 * reconciles exactly one Repoid at a time, pruning anything inside it that the
 * applied tree does not contain. A Dashboard made from a template has no
 * repository behind it, so it needs a boundary no apply ever targets. The
 * `everr:` scheme prefix cannot be produced by slug inference or by a Manifest
 * value that is a valid slug, so this boundary is unreachable from apply by
 * construction — not by a rule someone has to remember.
 *
 * The cross-Repoid collision check still applies in the other direction: an
 * apply that creates the same (project, slug) reports an ownership conflict and
 * fails, or transfers it with `--adopt`. That is the correct outcome, and it is
 * the documented path for promoting a UI-made Dashboard into as-code.
 */
export const UI_REPOID = "everr:ui";

export function isUiOwned(repoid: string | null | undefined): boolean {
  return repoid === UI_REPOID;
}

/**
 * The slug a template will be created under, given what the project already
 * holds. Live identity is (org, project, slug) across every Repoid, so a second
 * copy — or a collision with an as-code Dashboard — has to land on its own slug.
 *
 * Shared by the server that performs the insert and the gallery that promises
 * the destination before the click: two implementations of this rule would let
 * the UI name one slug and the write produce another.
 */
export function plannedSlug(
  templateId: string,
  takenSlugs: Iterable<string>,
): string {
  const taken = new Set(takenSlugs);
  let slug = templateId;
  for (let n = 2; taken.has(slug); n++) slug = `${templateId}-${n}`;
  return slug;
}

/**
 * The handoff prompt for editing a Dashboard. Editing stays a prompt handoff on
 * purpose: there is no editor UI, and the Agent already knows how to write and
 * apply the YAML through the `everr-setup-resources` Skill. Naming the project
 * and slug is what makes the handoff land on this Dashboard rather than a new
 * one.
 *
 * A UI-owned Dashboard is applied with `--adopt` because it starts under the
 * `everr:ui` boundary: the first edit moves it into the repository the Agent is
 * working in, and from then on it is an ordinary as-code Dashboard. Adopt only
 * transfers the resources present in the applied tree, so nothing else moves
 * with it.
 */
export function editDashboardPrompt(input: {
  project: string;
  slug: string;
  name: string;
  uiOwned: boolean;
}): string {
  const apply = input.uiOwned
    ? "`everr apply --adopt` (it was created from a template, so the first apply takes ownership for this repo)"
    : "`everr apply`";
  return `/everr-setup-resources Edit the "${input.name}" dashboard. Read what is live with \`everr resources show dashboard ${input.slug} --project ${input.project}\`, make the change described below, then apply it back with ${apply}.

What to change: `;
}
