const INSTALL_URL = import.meta.env.DEV
  ? "http://localhost:3000/install-dev.sh"
  : "https://everr.dev/install.sh";

export const INSTALL_COMMAND = `curl -fsSL ${INSTALL_URL} | sh`;

export const DESKTOP_DOWNLOAD_URL =
  "https://everr.dev/everr-app/everr-macos-arm64.dmg";
