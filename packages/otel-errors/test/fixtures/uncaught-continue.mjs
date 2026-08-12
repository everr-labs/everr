import { startSdk } from "./fixture-sdk.mjs";

startSdk({ onFatal: "continue" });

setTimeout(() => {
  throw new Error("fixture-survivable");
}, 10);

setTimeout(() => process.exit(0), 200);
