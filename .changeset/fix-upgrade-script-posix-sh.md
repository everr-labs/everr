---
"@everr/desktop-app": patch
---

Fix the `upgrade.sh` script to run on Linux (e.g. Ubuntu) by making it POSIX `sh` compatible. It previously used `set -o pipefail`, which fails under `dash` (the default `/bin/sh` on Ubuntu), so `curl … | sh` aborted before upgrading. It now matches `install.sh` with a `#!/bin/sh` shebang and `set -eu`.
