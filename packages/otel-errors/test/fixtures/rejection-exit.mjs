import { startSdk } from "./fixture-sdk.mjs";

startSdk({ onUnhandledRejection: "strict" });

Promise.reject(new Error("fixture-rejection"));
