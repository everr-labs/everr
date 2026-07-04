# Infer repo identity from the git remote; switch ownership with --transfer-from

A repository's Repoid (the apply Ownership boundary) is inferred from its `origin` remote, normalized to the `host/owner/repo` slug, which makes the `everr.yaml` Manifest optional: an explicit override for repos without a usable remote or that need a fixed identity, not a required file. Identity switches (a repository rename, or removing a legacy Manifest) are an explicit `everr apply --transfer-from <old-repoid>` that relabels the whole old boundary to the new identity in one transaction, rather than being tracked automatically.

## Considered options

- **Server-assigned UUID keyed by the remote** — rejected: keeps a hidden server-side mapping and still needs a rename story, so it buys nothing over deriving the identity directly.
- **First-commit hash as identity** — rejected: forks and template-derived repos share it, recreating the cross-repo ownership collision inference is meant to avoid.
- **Keep the Repoid but auto-generate `everr.yaml` on first apply** — rejected: the Manifest's only job was to carry an identity the `origin` remote already provides.
- **Extend `--adopt` to absorb the whole old boundary** (the first cut of the switch) — rejected: it corrupts adopt's targeted purpose, a partial cross-repo handoff would delete the rest of the source repo's resources. Adopt stays a targeted per-resource takeover; Transfer is the separate, total verb.

## Consequences

- Identity is derived from a mutable fact. A GitHub org/repo rename or a changed `origin` mints a new Repoid, orphaning the old boundary's live resources until a `--transfer-from` run re-homes them. Accepted because renames are rare and the cross-repo ownership-conflict error names the old Repoid, pointing straight at the fix.
- One boundary per repository. Two apply roots in one repo infer the same identity, so a repo that genuinely needs two boundaries must pin distinct Repoids via Manifests.
- The slug normalization is load-bearing: ssh, https, and scp clone URLs of one repository must reduce to the same string (lowercased `host/owner/repo`, with credentials, port, and a trailing `.git` stripped), or the same repo would split into two identities.
