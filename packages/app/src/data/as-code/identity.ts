// The CC-side encoding of everr's (project, slug) identity: CC stays
// project-agnostic and stores one `name` string, so everr writes
// "project/slug" (always explicit, "default" included) and splits it back on
// the first "/". Slashless names (engine-generated, e.g. "rule-<shortid>")
// read as slugs in the default project.

export function formatResourceName(project: string, slug: string): string {
  return `${project}/${slug}`;
}

export function parseResourceName(name: string): {
  project: string;
  slug: string;
} {
  const i = name.indexOf("/");
  if (i === -1) return { project: "default", slug: name };
  return { project: name.slice(0, i), slug: name.slice(i + 1) };
}
