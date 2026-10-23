import { loadEnv } from "vite";

const [product, binary, ...args] = process.argv.slice(2);
if (!binary || !["app", "cloud"].includes(product)) {
  throw new Error("Usage: github-collector.mjs <app|cloud> <binary> [args...]");
}

const mode = product === "cloud" ? "cloud" : "development";
const env = {
  ...loadEnv(mode, `${process.env.DEV_ROOT}/packages/${product}`, ""),
  ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
};
if (env.NODE_EXTRA_CA_CERTS) env.SSL_CERT_FILE = env.NODE_EXTRA_CA_CERTS;
for (const key of ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_WEBHOOK_SECRET"]) {
  if (!env[key]) throw new Error(`Set ${key} in packages/${product}/.env`);
}

process.execve(binary, [binary, ...args], env);
