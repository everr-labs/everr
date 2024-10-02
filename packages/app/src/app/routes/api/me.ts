import { json } from '@tanstack/start';
import { createAPIFileRoute } from '@tanstack/start/api';
import { authenticateRequest } from '~server/authenticateRequest';
import { authOptions } from '~server/authOptions';

export const Route = createAPIFileRoute('/api/me')({
	GET: async ({ request }) => {
		const requestState = await authenticateRequest(request, authOptions);

		return json(requestState);
	},
});
