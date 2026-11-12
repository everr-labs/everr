{
  description = "Everr local development environment";

  # Optional: everything here can still be installed by hand (see docs/development.md).
  # With direnv, `cd` into the repo loads the shell automatically (see .envrc).

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            go_1_26 # fetches the exact go.mod toolchain if newer (GOTOOLCHAIN=auto)
            nodejs_24 # .node-version
            pnpm # switches itself to package.json's packageManager version
            process-compose # `pnpm dev`
            gnumake
          ];

          # Docker with Compose is still required and comes from the host
          # (Docker Desktop, OrbStack, ...).

          # If mise is also active, let this shell's node win over .node-version.
          MISE_DISABLE_TOOLS = "node";
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt-tree);
    };
}
