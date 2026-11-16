// verify-web-app: entry of the SDK page. web-sdk-page fills the import path with this
// checkout's packages/otel-web/src and bundles it with esbuild.
// Query params: otlp (OTLP base endpoint), key (public ek_ key, absent for the local collector),
// service (service.name, default verify-sdk-web).
import { WebSDK, errors, network } from "__OTEL_WEB_INDEX__";

const params = new URLSearchParams(location.search);
const sdk = new WebSDK({
  serviceName: params.get("service") ?? "verify-sdk-web",
  ingestKey: params.get("key") ?? undefined,
  endpoint: params.get("otlp") ?? undefined,
  instrumentations: [errors(), network()],
});
Object.assign(window, { verifySdk: { sdk } });

const byId = (id: string) => document.getElementById(id) as HTMLElement;
let items = 0;
byId("add").addEventListener("click", () => {
  items++;
  const li = document.createElement("li");
  li.textContent = `verify sdk item ${items}`;
  byId("items").appendChild(li);
  byId("count").textContent = String(items);
});
byId("boom").addEventListener("click", () => {
  setTimeout(() => {
    throw new Error("VerifySdkError: checkout exploded");
  }, 0);
});
// Port 9 (discard) is closed on loopback, so the request gets no response: a network failure.
byId("fail-fetch").addEventListener("click", () => {
  fetch("http://127.0.0.1:9/verify-api/checkout").catch(() => {
    byId("status").textContent = "request failed";
  });
});
byId("status").textContent = "sdk ready";
