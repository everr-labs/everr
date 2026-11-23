import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { ShellRouterContext } from "../../explore/backend";

export const Route = createRootRouteWithContext<ShellRouterContext>()({ component: Outlet });
