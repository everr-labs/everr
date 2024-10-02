import type { Session, User } from '@auth/core/types';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

interface MyRouterContext {
	user: User;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	beforeLoad: async () => {
		const res = await fetch('/api/me');

		const session = (await res.json()) as Session | null;

		return {
			user: session?.user,
		};
	},
	component: () => (
		<>
			<Outlet />
		</>
	),
});
