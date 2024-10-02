import { Auth } from '@auth/core';
import { createAPIFileRoute } from '@tanstack/start/api';
import { authOptions } from '~server/authOptions';

export const Route = createAPIFileRoute('/api/auth/$')({
	GET: async ({ request }) => {
		return Auth(request, authOptions);
	},
	POST: async ({ request }) => {
		return Auth(request, authOptions);
	},
});
