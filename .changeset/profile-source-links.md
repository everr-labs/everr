---
"@everr/app": patch
---

Profiles no longer link frames from installed dependencies, build output or bundler virtual modules to GitHub, where those files don't exist. Frames from a module id with a query, such as a server function, now link to their source file.
