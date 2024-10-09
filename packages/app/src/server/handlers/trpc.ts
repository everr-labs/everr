import type { IncomingMessage, ServerResponse } from 'http';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import { createTRPCContext } from '~server/trpc/trpc';
import appRouter from '$vinxi/trpc/router';
import { fromNodeMiddleware } from 'vinxi/http';

import { env } from '../../../src/env';

const createContext = async (req: IncomingMessage) => {
	return createTRPCContext(req);
};

const handler = createHTTPHandler({
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	router: appRouter,

	createContext: ({ req }) => createContext(req),
	onError:
		env.NODE_ENV === 'development'
			? ({ path, error }) => {
					console.error(
						`❌ tRPC failed on ${path ?? '<no-path>'}: ${error.message}`,
					);
				}
			: undefined,
});

export default fromNodeMiddleware(
	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	(req: IncomingMessage, res: ServerResponse) => {
		// (async () => {
		req.url = req.url?.replace(env.BASE_URL, '');
		return handler(req, res);
		// })().catch((err) => {
		// console.error(err);
		// res.statusCode = 500;
		// res.end();
		// });
	},
);
