import type { IncomingMessage } from 'http';
import { initTRPC, TRPCError } from '@trpc/server';
import { authOptions } from '~server/authOptions';
import { clickhouse } from '~server/clickhouse';
import { db } from '~server/db';
import SuperJSON from 'superjson';
import { ZodError } from 'zod';

import { authenticateRequest } from '@citric/auth';

export const createTRPCContext = async (req: IncomingMessage) => {
	const url = `http://${req.headers.host}${req.url}`;
	const request = new Request(url, { headers: req.headers as HeadersInit });
	const session = await authenticateRequest(request, authOptions);

	return {
		db,
		session,
		clickhouse,
	};
};

const t = initTRPC.context<typeof createTRPCContext>().create({
	transformer: SuperJSON,
	errorFormatter({ shape, error }) {
		return {
			...shape,
			data: {
				...shape.data,
				zodError:
					error.cause instanceof ZodError ? error.cause.flatten() : null,
			},
		};
	},
});

export const createTRPCRouter = t.router;

export const publicProcedure = t.procedure;

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.session?.user) {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}

	return next({
		ctx: {
			// infers the `session` as non-nullable
			session: { ...ctx.session, user: ctx.session.user },
		},
	});
});
