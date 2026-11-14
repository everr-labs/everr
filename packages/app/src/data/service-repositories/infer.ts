import { z } from "zod";

/** A GitHub repository as Everr stores it: `owner/name`. */
export const GithubRepositorySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, { error: "repository must be owner/name" });

/**
 * `owner/name` from a GitHub repository URL as `vcs.repository.url.full`
 * carries it: https, ssh, or scp form, with or without `.git`. Null for
 * anything not on github.com.
 */
export function githubRepoFromUrl(url: string): string | null {
  const match =
    /^(?:https?:\/\/|ssh:\/\/git@|git@)github\.com[/:]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(
      url.trim(),
    );
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * The repository a `vcs.repository.name` names. Everr's CI telemetry writes
 * `owner/name`; semconv only asks for the name, so a bare name matches the one
 * repository Everr knows with that name, and nothing when two share it.
 */
export function githubRepoFromName(name: string, known: readonly string[]): string | null {
  const trimmed = name.trim();
  if (GithubRepositorySchema.safeParse(trimmed).success) return trimmed;
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  const matches = known.filter(
    (repo) => repo.slice(repo.indexOf("/") + 1).toLowerCase() === trimmed.toLowerCase(),
  );
  return matches.length === 1 ? matches[0] : null;
}

/** A `service.version` that is a commit SHA, full or abbreviated. */
export function commitSha(version: string): string | null {
  const trimmed = version.trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(trimmed) ? trimmed : null;
}
