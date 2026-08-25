// Canonical encoding of Everr's (project, slug) identity. The project is
// always explicit, including "default".

export function formatResourceName(project: string, slug: string): string {
  return `${project}/${slug}`;
}

export function parseResourceName(name: string): {
  project: string;
  slug: string;
} {
  const i = name.indexOf("/");
  if (i <= 0 || i === name.length - 1) {
    throw new Error(`invalid resource name: ${name}`);
  }
  return { project: name.slice(0, i), slug: name.slice(i + 1) };
}

export function findByResourceName<T extends { name: string }>(
  items: readonly T[],
  project: string,
  slug: string,
): T | undefined {
  return items.find((item) => item.name === formatResourceName(project, slug));
}
