import { Outlet, useMatch } from "@tanstack/react-router";
import { TracesSearchPage } from "./traces-search-page";

export function TracesRoute() {
  const traceDetailMatch = useMatch({
    from: "/_authenticated/_dashboard/traces/$traceId",
    shouldThrow: false,
  });
  return traceDetailMatch ? <Outlet /> : <TracesSearchPage />;
}
