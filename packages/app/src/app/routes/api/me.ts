import { json } from '@tanstack/start';
import { createAPIFileRoute } from '@tanstack/start/api';
import { authOptions } from '~server/authOptions';

import { authenticateRequest } from '@citric/auth';

export const Route = createAPIFileRoute('/api/me')({
	GET: async ({ request }) => {
		const requestState = await authenticateRequest(request, authOptions);

		return json(requestState);
	},
});
