---
"@everr/desktop-app": minor
---

Add `everr upgrade`: the CLI now updates itself in place — it checks the published release version (no-op when already current), downloads the right binary for the platform, verifies its sha256 checksum, and atomically replaces the running executable wherever it is installed. The update notice now suggests `everr upgrade` instead of the curl script.
