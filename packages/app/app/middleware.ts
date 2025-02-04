import { defineMiddleware } from 'vinxi/http';

import { auth } from './lib/auth';

export default defineMiddleware({
	onRequest: async (event) => {
		const session = await auth.api.getSession({
			headers: event.headers,
		});

		const authResult = !session
			? { isAuthenticated: false, user: null, session: null }
			: {
					isAuthenticated: true,
					user: session.user,
					session: session.session,
				};

		event.context.auth = authResult;
	},
});
