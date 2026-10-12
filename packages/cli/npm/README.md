# Everr CLI

Install Everr in your project:

```sh
npm install --save-dev @everr/cli
npx everr local start
```

Run it without adding a dependency:

```sh
npx @everr/cli local start
```

Or install it globally:

```sh
npm install --global @everr/cli
everr local start
```

Requires Node.js 20 or newer. Supported platforms are macOS Apple Silicon and Linux ARM64 or x64 with glibc. Linux binaries are built on Ubuntu 24.04. Intel Macs, Windows, and Alpine Linux are not supported.

The matching platform package contains the prebuilt Rust executable, local browser UI, telemetry collector, chDB library, and agent skills. No compilation or installation scripts are needed. Keep optional dependencies enabled when installing.

Local telemetry works without an account. Start the collector and browser UI with `everr local start` (or `npx everr local start` for a project installation).

Update a project installation with `npm install @everr/cli@latest`, or a global installation with `npm install --global @everr/cli@latest`. `everr upgrade` prints the appropriate npm instruction. For a temporary installation, run `npx @everr/cli@latest local start`.

`everr uninstall` removes local Everr state and globally installed skills, then prints the npm removal instruction. Remove the project dependency with `npm uninstall @everr/cli`, or the global package with `npm uninstall --global @everr/cli`.

See the [installation guide](https://everr.dev/docs/learn/install) and [CLI reference](https://everr.dev/docs/reference/cli).
