import { BUILTIN_PROJECT } from "../schema";

/**
 * The handoff prompt for making your own Dashboard from a built-in. Creation
 * stays a prompt handoff on purpose: a Dashboard is a document reconciled by
 * apply, so the only writer that keeps as-code and the app in step is the one
 * that goes through apply — which is what the Agent already does through the
 * `everr-setup-resources` Skill (ADR 0004).
 *
 * The Agent reads the built-in through `everr resources show` rather than the
 * prompt carrying the YAML: the catalog is served by the same resources API
 * under the reserved `built-in` project, so the copy is always the current
 * catalog version, not the one from when the prompt was written.
 */
export function createFromBuiltinPrompt(input: {
  slug: string;
  name: string;
}): string {
  return `/everr-setup-resources Create a new dashboard for this repository, starting from Everr's built-in "${input.name}" dashboard. Read it with \`everr resources show dashboard ${input.slug} --project ${BUILTIN_PROJECT}\`, save it as a new as-code dashboard file here under a slug and project of ours (not "${BUILTIN_PROJECT}"), adapt it to our telemetry, then run \`everr apply\`.

What to change from the built-in: `;
}
