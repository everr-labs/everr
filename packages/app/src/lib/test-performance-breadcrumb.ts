import { testNameSeparator } from "@/lib/formatting";
import type { BreadcrumbSegment } from "@/router-types";

export function buildTestPerformanceBreadcrumb(search: {
  pkg?: string;
  path?: string;
}): string | BreadcrumbSegment[] {
  const { path, pkg } = search;
  if (!pkg && !path) return "Test Performance";

  const segments: BreadcrumbSegment[] = [
    {
      label: "Test Performance",
      search: { pkg: undefined, path: undefined },
    },
  ];

  if (!pkg) return segments;

  segments.push({ label: pkg, search: { pkg, path: undefined } });
  if (!path) return segments;

  const sep = testNameSeparator(path);
  const vitestPrefix = `${pkg} > `;
  const isVitest = sep === " > " && path.startsWith(vitestPrefix);
  const displayPath = isVitest ? path.slice(vitestPrefix.length) : path;
  const parts = displayPath.split(sep);

  for (let i = 0; i < parts.length; i++) {
    const partialPath = parts.slice(0, i + 1).join(sep);
    segments.push({
      label: parts[i],
      search: {
        pkg,
        path: isVitest ? vitestPrefix + partialPath : partialPath,
      },
    });
  }

  return segments;
}
