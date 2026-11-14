/** The code a profile's samples came from, from the `vcs.*` resource attributes. */
export type ProfileSource = {
  /** `vcs.repository.url.full` */
  repository: string;
  /** `vcs.ref.head.revision` */
  revision: string;
};

/**
 * A link to a file at the profiled revision, in the GitHub URL layout that
 * GitHub, GitLab and Gitea all serve. Only for repo-relative paths: an absolute
 * path is where the file sat on the profiled host, not in the repository.
 */
export function sourceLink(
  source: ProfileSource | undefined,
  file: string,
  line: number,
): string | undefined {
  if (!source?.repository || !source.revision || !file) return undefined;
  let repository: URL;
  try {
    repository = new URL(source.repository);
  } catch {
    return undefined;
  }
  if (repository.protocol !== "https:" && repository.protocol !== "http:") return undefined;
  const path = file.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = path.split("/");
  if (
    path.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(path) ||
    segments.some((segment) => segment === ".." || segment === "")
  ) {
    return undefined;
  }
  const base = `${repository.origin}${repository.pathname.replace(/\/+$/, "").replace(/\.git$/, "")}`;
  const encoded = segments.map(encodeURIComponent).join("/");
  return `${base}/blob/${encodeURIComponent(source.revision)}/${encoded}${line > 0 ? `#L${line}` : ""}`;
}
