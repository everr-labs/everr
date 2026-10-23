import { loadEnv } from "vite";

const [product, binary, ...args] = process.argv.slice(2);
if (!binary || !["app", "cloud"].includes(product)) {
  throw new Error("Usage: collector.mjs <app|cloud> <binary> [args...]");
}

const env = {
  ...loadEnv("development", `${process.env.DEV_ROOT}/packages/${product}`, ""),
  ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
};
for (const key of ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_WEBHOOK_SECRET"]) {
  if (!env[key]) throw new Error(`Set ${key} in packages/${product}/.env`);
}

process.execve(binary, [binary, ...args], env);
