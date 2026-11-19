---
"@everr/app": patch
---

CLI commands that use a saved session, such as `everr cloud query`, `everr cloud status` and `everr resources`, now report "Session expired. Run `everr cloud login` to re-authenticate." when the session is missing, revoked or expired, instead of failing with `500 Internal Server Error`. When the session has no active organization, or the user is no longer a member of it, the server now answers `403 Forbidden` with the reason instead of a 500.
