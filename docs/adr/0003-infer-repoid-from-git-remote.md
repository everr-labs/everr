# Infer repo identity from the git remote

A repository's Repoid (the apply Ownership boundary) is inferred from its `origin` remote, normalized to the `host/owner/repo` slug. This makes the `everr.yaml` Manifest optional: an explicit override for repos without a usable remote or that need a fixed identity, not a required file.

## Considered options

- **Server-assigned UUID keyed by the remote**: rejected. It keeps a hidden server-side mapping and still needs a rename story, so it buys nothing over deriving the identity directly.
- **First-commit hash as identity**: rejected. Forks and template-derived repos share it, recreating the cross-repo ownership collision inference is meant to avoid.
- **Keep the Repoid but auto-generate `everr.yaml` on first apply**: rejected. The Manifest's only job was to carry an identity the `origin` remote already provides.

## Consequences

- Identity is derived from a mutable fact. A GitHub org/repo rename or a changed `origin` mints a new Repoid, orphaning the old boundary's live resources. The cross-repo ownership-conflict error names the old Repoid, so the split is observable rather than silent. Accepted because renames are rare and the identity is otherwise zero-config.
- One boundary per repository. Two apply roots in one repo infer the same identity, so a repo that genuinely needs two boundaries must pin distinct Repoids via Manifests.
- The slug normalization is load-bearing: ssh, https, and scp clone URLs of one repository must reduce to the same string (lowercased `host/owner/repo`, with credentials, port, and a trailing `.git` stripped), or the same repo would split into two identities.
