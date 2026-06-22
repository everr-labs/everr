---
"@everr/desktop-app": patch
---

Fix `everr local start` on Linux by embedding the collector and chDB assets in the published Linux CLI release (the build now fails if the assets are missing). Also make the install script configure your shell PATH automatically instead of only printing a hint.
