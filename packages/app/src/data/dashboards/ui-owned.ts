import { UI_REPOID } from "@/data/as-code/repoid";

export { UI_REPOID };

export function isUiOwned(repoid: string | null | undefined): boolean {
  return repoid === UI_REPOID;
}

/**
 * The slug a template will be created under, given what the project already
 * holds. Live identity is (org, project, slug) across every Repoid, so a second
 * copy — or a collision with an as-code Dashboard — has to land on its own slug.
 *
 * The write is the only caller: what the gallery needs is whether a template
 * already made a Dashboard, which the document records as `metadata.template`
 * rather than re-deriving from the slug — a rule that stops being true the
 * moment a collision renames the copy.
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
