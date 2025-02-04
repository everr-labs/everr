import { Sidebar } from '@/components/sidebar';
import { TopNav } from '@/components/topnav';
import { getAuthQueryOptions } from '@/lib/auth-client';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated')({
	beforeLoad: async ({ context, location }) => {
		const { isAuthenticated } = await context.queryClient.ensureQueryData(
			getAuthQueryOptions(),
		);

		if (!isAuthenticated) {
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw redirect({
				to: '/auth/login',
				search: {
					redirect: location.href,
				},
			});
		}
	},
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	return (
		<div className="flex min-h-screen w-full flex-col bg-muted/40">
			<Sidebar />
			<div className="flex min-h-screen flex-col sm:gap-4 sm:py-4 sm:pl-14">
				<TopNav />

				<main className="grid min-h-full flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
