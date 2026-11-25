---
"@everr/app": patch
---

Profiles are easier to read:

- CPU flame graphs hide `(idle)`, the CPU the JavaScript thread uses while it waits for work, by default. Turn on "Include idle" in the filters to see it.
- Hovering the runtime frames `Non JS threads activity`, `Garbage Collection` and `(idle)` explains what they measure, including why CPU time can exceed wall time.
- Frames from the app's own server code now resolve to their TypeScript files, so their source links work.
