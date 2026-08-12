import { startSdk } from "./fixture-sdk.mjs";

startSdk();

Promise.reject(new Error("fixture-rejection"));
