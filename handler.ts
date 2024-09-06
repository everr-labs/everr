import { type IncomingMessage, type ServerResponse } from 'http';

import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import appRouter from '$vinxi/trpc/router';
import { fromNodeMiddleware } from 'vinxi/http';

const handler = createHTTPHandler({
	router: appRouter,

	createContext() {
		return {};
	},
});

export default fromNodeMiddleware(
	(req: IncomingMessage, res: ServerResponse) => {
		(async () => {
			console.log(req.url);
			req.url = req.url?.replace(import.meta.env.BASE_URL, '');
			return handler(req, res);
		})().catch((err) => {
			console.error(err);
			res.statusCode = 500;
			res.end();
		});
	},
);
