const INSTALL_URL = import.meta.env.DEV
  ? "http://localhost:3000/install-dev.sh"
  : "https://everr.dev/install.sh";

export const INSTALL_COMMAND = `curl -fsSL ${INSTALL_URL} | sh`;
