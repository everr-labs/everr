import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated')({
	beforeLoad: ({ context }) => {
		if (!context.user) {
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw redirect({
				to: '/auth/login',
				search: {
					// Use the current location to power a redirect after login
					// (Do not use `router.state.resolvedLocation` as it can
					// potentially lag behind the actual current location)
					redirect: location.href,
				},
			});
		}

		return {
			user: context.user,
		};
	},
});
