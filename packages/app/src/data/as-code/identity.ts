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

// Resolve (project, slug) against stored engine names by parsing each name,
// not by formatting the target: a bare "x" and a qualified "default/x" both
// address default/x, and every name the listings render must resolve here.
// The exact qualified form wins if both spellings coexist in the set.
export function findByResourceName<T extends { name: string }>(
  items: readonly T[],
  project: string,
  slug: string,
): T | undefined {
  const exact = formatResourceName(project, slug);
  return (
    items.find((item) => item.name === exact) ??
    items.find((item) => {
      const parsed = parseResourceName(item.name);
      return parsed.project === project && parsed.slug === slug;
    })
  );
}
